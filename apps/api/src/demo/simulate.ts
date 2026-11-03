/*
 * Rehearsal simulator (development only). Customers order through the real API every couple of
 * minutes; autopilot accounts play every role you aren't playing, so there's always something to do.
 *
 *   npm run demo:simulate -w @oyo/api -- --you kitchen       # you run Hill Top's kitchen
 *   npm run demo:simulate -w @oyo/api -- --you dispatch      # you assign the riders
 *   npm run demo:simulate -w @oyo/api -- --you rider         # dispatch sends you jobs first
 *   options: --every 120 (seconds between orders, on average) --minutes 60 --api http://localhost:3001
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AuthService } from '../auth/auth.service.js';
import { PwnedPasswordsChecker } from '../auth/passwords.js';
import { base32Decode, timeStep, totpAt } from '../auth/totp.js';
import { loadConfig } from '../config.js';
import { createDb, createPool } from '../db/client.js';
import type { DemoLogin } from './demo-setup.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

// Args
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const API = arg('api', process.env.API_URL ?? 'http://localhost:3001');
const YOU = arg('you', 'none') as 'none' | 'kitchen' | 'dispatch' | 'rider';
const EVERY_S = Number(arg('every', '120'));
const MINUTES = Number(arg('minutes', '60'));
const TOWN = { lat: 7.049, lng: 80.534 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const jitter = (p: { lat: number; lng: number }, metres: number) => ({
  lat: p.lat + ((Math.random() - 0.5) * 2 * metres) / 111_000,
  lng: p.lng + ((Math.random() - 0.5) * 2 * metres) / 110_000,
});
const time = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo' });
const log = (who: string, msg: string) => console.log(`${time()}  ${who.padEnd(12)} ${msg}`);
const lkr = (c: number) => `LKR ${(c / 100).toLocaleString('en-GB')}`;

// HTTP with a token that refreshes itself
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
class Client {
  access = '';
  refresh = '';
  constructor(
    readonly name: string,
    private readonly signIn: () => Promise<{ accessToken: string; refreshToken: string }>,
    readonly deviceId: string,
  ) {}

  async start() {
    const t = await this.signIn();
    this.access = t.accessToken;
    this.refresh = t.refreshToken;
    return this;
  }

  async call(
    method: string,
    path: string,
    body?: unknown,
    opts: { key?: string; form?: FormData } = {},
  ): Promise<Json> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(API + path, {
        method,
        headers: {
          authorization: `Bearer ${this.access}`,
          'x-device-id': this.deviceId,
          ...(opts.form ? {} : { 'content-type': 'application/json' }),
          ...(opts.key ? { 'idempotency-key': opts.key } : {}),
        },
        body: opts.form ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      if (res.status === 401 && attempt === 0) {
        const r = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refresh }),
        });
        if (r.ok) {
          const t = (await r.json()) as { accessToken: string; refreshToken: string };
          this.access = t.accessToken;
          this.refresh = t.refreshToken;
        } else await this.start();
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.error ?? text}`);
      return json;
    }
  }
}

async function staffClient(l: DemoLogin): Promise<Client> {
  const deviceId = `autopilot-${l.username.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 64);
  return new Client(
    l.username,
    async () => {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: l.username,
          password: l.password,
          deviceId,
          ...(l.totpSecret && {
            totpCode: totpAt(base32Decode(l.totpSecret), timeStep(new Date())),
          }),
        }),
      });
      const json = (await res.json()) as Json;
      if (!res.ok)
        throw new Error(
          `${l.username} can't sign in: ${json.error}. Run npm run demo:setup again.`,
        );
      return json.tokens;
    },
    deviceId,
  ).start();
}

const CUSTOMERS = [
  ['Nimali Fernando', 'near the temple'],
  ['Ruwan Jayasinghe', 'blue gate'],
  ['Dilani Perera', 'opposite the post office'],
  ['Kamal Gunasekara', 'second floor'],
  ['Shanika Wijeratne', 'yellow house'],
  ['Tharindu Rathnayake', 'by the bus stand'],
  ['Ayesha Nazeer', 'call on arrival'],
  ['Sunil Herath', 'behind the school'],
] as const;

async function customers(): Promise<
  { client: Client; name: string; addressId: string; at: { lat: number; lng: number } }[]
> {
  // Customers sign in in-process: the OTP is caught here instead of being texted.
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const codes = new Map<string, string>();
  const auth = new AuthService(
    db,
    { hashKey: config.hashKey, encryptionKey: config.encryptionKey },
    {
      send: async (phone: string, text: string) =>
        void codes.set(phone, text.match(/\d{6}/)?.[0] ?? ''),
    },
    new PwnedPasswordsChecker(),
  );
  const out = [];
  try {
    for (const [i, [name, note]] of CUSTOMERS.entries()) {
      const phone = `+9477020${String(i + 1).padStart(4, '0')}`;
      const deviceId = `sim-customer-${i + 1}`;
      const client = await new Client(
        name,
        async () => {
          await auth.requestOtp(phone, { deviceId }).catch(() => undefined);
          const r = await auth.verifyOtp(
            { phone, code: codes.get(phone) ?? '', acceptTerms: true },
            { deviceId },
          );
          return r.tokens;
        },
        deviceId,
      ).start();
      await client.call('PATCH', '/me/profile', { displayName: name });
      const existing = (await client.call('GET', '/me/addresses')) as {
        id: string;
        lat: number;
        lng: number;
      }[];
      const at = existing[0] ?? jitter(TOWN, 1500);
      const addressId =
        existing[0]?.id ??
        (
          await client.call('POST', '/me/addresses', {
            label: 'Home',
            ...at,
            addressText: `${10 + i} Lane ${i + 1}, Nawalapitiya`,
            note,
          })
        ).id;
      out.push({ client, name, addressId, at: { lat: at.lat, lng: at.lng } });
    }
  } finally {
    await pool.end();
  }
  return out;
}

async function slipImage() {
  return sharp(randomBytes(120 * 160 * 3), { raw: { width: 120, height: 160, channels: 3 } })
    .jpeg()
    .toBuffer();
}

async function main() {
  if (loadConfig().env === 'production') throw new Error('demo:simulate is for development only');
  const logins = JSON.parse(
    readFileSync(join(process.cwd(), '.demo', 'logins.json'), 'utf8'),
  ) as DemoLogin[];
  const auto = logins.filter((l) => l.for === 'autopilot');
  const humanRider = logins.find((l) => l.username === 'demo.rider');

  console.log(
    `Simulating ${MINUTES} min against ${API}; an order about every ${EVERY_S}s. You play: ${YOU}.`,
  );
  const shoppers = await customers();
  log('setup', `${shoppers.length} customers signed in`);

  const kitchens = await Promise.all(
    auto
      .filter((l) => l.username.startsWith('auto.kitchen.'))
      // You run Hill Top's kitchen yourself when playing the kitchen.
      .filter((l) => !(YOU === 'kitchen' && l.restaurant?.startsWith('Hill Top')))
      .map(staffClient),
  );
  const dispatch =
    YOU === 'dispatch'
      ? null
      : await staffClient(auto.find((l) => l.username === 'auto.dispatch')!);
  const ridersAuto = await Promise.all(
    auto.filter((l) => l.username.startsWith('auto.rider.')).map(staffClient),
  );
  log(
    'setup',
    `autopilot: ${kitchens.length} kitchens, ${dispatch ? 'dispatch, ' : ''}${ridersAuto.length} riders`,
  );

  // Riders go online near town.
  const riderAt = new Map<Client, { lat: number; lng: number }>();
  for (const r of ridersAuto) {
    riderAt.set(r, jitter(TOWN, 800));
    await r.call('POST', '/rider/location', riderAt.get(r));
    await r.call('POST', '/rider/status', { online: true }).catch(() => undefined);
  }

  const seen = new Map<string, number>(); // first time we noticed something, by key
  const since = (key: string) => {
    if (!seen.has(key)) seen.set(key, Date.now());
    return (Date.now() - seen.get(key)!) / 1000;
  };
  const end = Date.now() + MINUTES * 60_000;
  let nextOrder = Date.now() + 3_000;
  let humanRiderId: string | null = null;

  const placeOrder = async () => {
    const s = pick(shoppers);
    const list = (
      (await s.client.call('GET', `/restaurants?lat=${s.at.lat}&lng=${s.at.lng}`)) as Json[]
    ).filter((r) => r.isOpen);
    if (!list.length) return log(s.name.split(' ')[0]!, 'nothing open nearby');
    // When you run Hill Top's kitchen, it gets more of the orders.
    const r =
      YOU === 'kitchen' && Math.random() < 0.6
        ? (list.find((x) => x.name.startsWith('Hill Top')) ?? pick(list))
        : pick(list);
    const menu = await s.client.call('GET', `/restaurants/${r.id}`);
    const items = (menu.categories as Json[])
      .flatMap((c) => c.items)
      .filter((i: Json) => !i.soldOut);
    const lines = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
      const it = pick(items);
      return {
        menuItemId: it.id,
        quantity: Math.random() < 0.2 ? 2 : 1,
        modifierIds: (it.groups as Json[])
          .filter((g) => g.minSelect > 0)
          .map((g) => pick((g.options as Json[]).filter((o) => !o.soldOut)).id),
      };
    });
    const body = { restaurantId: r.id, addressId: s.addressId, items: lines };
    const quote = await s.client.call('POST', '/orders/quote', body);
    const method =
      quote.paymentMethods.includes('bank_transfer') && Math.random() < 0.25
        ? 'bank_transfer'
        : 'cod';
    const order = await s.client.call(
      'POST',
      '/orders',
      { ...body, paymentMethod: method },
      { key: `sim-${randomBytes(8).toString('hex')}` },
    );
    log(
      s.name.split(' ')[0]!,
      `ordered #${order.reference} from ${r.name} · ${lkr(order.totalCents)} · ${method === 'cod' ? 'cash' : 'bank transfer'}`,
    );
    if (method === 'bank_transfer') {
      setTimeout(() => {
        void (async () => {
          const form = new FormData();
          form.append('bankReference', `CB${Math.floor(Math.random() * 1e6)}`);
          form.append(
            'slip',
            new Blob([new Uint8Array(await slipImage())], { type: 'image/jpeg' }),
            'slip.jpg',
          );
          await s.client.call('POST', `/orders/${order.id}/slip`, undefined, { form });
          log(s.name.split(' ')[0]!, `uploaded a bank slip for #${order.reference}`);
        })().catch((e) => log('error', String(e)));
      }, 20_000);
    }
  };

  const tried = new Set<string>();
  const runOut = async (k: Client, o: Json) => {
    const line = pick(o.lines as Json[]);
    const menu = await k.call('GET', '/restaurant/menu');
    const plain = (menu.categories as Json[])
      .flatMap((c) => c.items as Json[])
      .filter(
        (i) =>
          i.status === 'live' &&
          !i.soldOut &&
          i.id !== line.menuItemId &&
          (i.groups as Json[]).every((g) => g.minSelect === 0),
      )
      .sort((a, b) => a.priceCents - b.priceCents);
    const substitute = plain[0];
    // Without a substitute the only line would cancel the order; keep the demo flowing.
    if (!substitute) return;
    await k
      .call('POST', `/restaurant/orders/${o.id}/unavailable`, {
        orderItemId: line.id,
        availableQuantity: line.quantity > 1 ? line.quantity - 1 : 0,
        substituteMenuItemId: substitute.id,
      })
      .then(() => log('kitchen', `${o.reference}: out of ${line.name}, offered ${substitute.name}`))
      .catch((e) => log('kitchen', `${o.reference}: couldn't offer a substitute (${String(e)})`));
  };

  const kitchenTick = async (k: Client) => {
    const b = await k.call('GET', '/restaurant/board');
    for (const o of b.new as Json[]) {
      if (since(`new:${o.id}`) < 15) continue;
      await k.call('POST', `/restaurant/orders/${o.id}/accept`, { prepMinutes: pick([10, 15]) });
      log('kitchen', `${b.restaurant.name} accepted #${o.reference}`);
    }
    for (const o of b.preparing as Json[]) {
      if ((o.itemChanges as Json[]).some((c) => c.status === 'pending')) continue;
      // Now and then the kitchen runs out of something (RES-05) and offers a plain substitute.
      if (!tried.has(o.id) && since(`prep:${o.id}`) > 20) {
        tried.add(o.id);
        if (Math.random() < 0.12) await runOut(k, o);
        continue;
      }
      // Demo pace: the food is ready a minute or two after accepting.
      if (since(`prep:${o.id}`) < 60 + Math.random() * 60) continue;
      await k.call('POST', `/restaurant/orders/${o.id}/ready`);
      log('kitchen', `${b.restaurant.name}: #${o.reference} is ready`);
    }
  };

  const dispatchTick = async (d: Client) => {
    const b = await d.call('GET', '/admin/board');
    for (const o of b.unassigned as Json[]) {
      if (o.offer) continue;
      await d.call('POST', `/admin/orders/${o.id}/lock`).catch(() => undefined);
      const cands = ((await d.call('GET', `/admin/orders/${o.id}/candidates`)) as Json[]).filter(
        (c) => c.eligible,
      );
      if (!cands.length) continue;
      const choice = (YOU === 'rider' && cands.find((c) => c.id === humanRiderId)) || cands[0];
      await d.call('POST', `/admin/orders/${o.id}/offer`, { riderId: choice.id });
      log('dispatch', `offered #${o.reference} to ${choice.name}`);
    }
    for (const slip of (await d.call('GET', '/admin/slips')) as Json[]) {
      if (Date.now() - new Date(slip.uploadedAt).getTime() < 30_000) continue;
      await d.call('POST', `/admin/slips/${slip.slipId}/approve`);
      log('dispatch', `approved the slip for #${slip.reference}`);
    }
    // Riders hand cash in before the cap.
    for (const r of ridersAuto) {
      const state = await r.call('GET', '/rider/state');
      if (state.cashHeldCents >= 800_000 && state.jobs.length === 0) {
        const id = (await r.call('GET', '/auth/me')).accountId;
        await d.call(
          'POST',
          `/admin/riders/${id}/handover`,
          { amountCents: state.cashHeldCents },
          { key: `sim-ho-${randomBytes(6).toString('hex')}` },
        );
        log('dispatch', `${r.name} handed in ${lkr(state.cashHeldCents)}`);
      }
    }
  };

  const riderTick = async (r: Client) => {
    const s = await r.call('GET', '/rider/state');
    let at = riderAt.get(r)!;
    if (s.offer && since(`offer:${s.offer.id}`) > 6) {
      await r.call('POST', `/rider/offers/${s.offer.id}/accept`);
      log('rider', `${r.name.replace('auto.', '')} accepted #${s.offer.reference}`);
    }
    for (const j of s.jobs as Json[]) {
      if (j.status === 'active') {
        at = jitter({ lat: j.restaurant.lat, lng: j.restaurant.lng }, 50);
        if (j.kitchenStatus === 'ready' && since(`ready:${j.orderId}`) > 30) {
          await r.call('POST', `/rider/orders/${j.orderId}/pickup`);
          log('rider', `picked up #${j.reference}`);
        }
      } else if (j.status === 'picked_up') {
        at = jitter({ lat: j.customer.lat, lng: j.customer.lng }, 50);
        if (since(`pickedup:${j.orderId}`) > 60 + Math.random() * 60) {
          await r.call(
            'POST',
            `/rider/orders/${j.orderId}/deliver`,
            j.paymentMethod === 'cod' ? { cashCollectedCents: j.collectCents } : {},
          );
          log(
            'rider',
            `delivered #${j.reference}${j.collectCents ? `, collected ${lkr(j.collectCents)}` : ''}`,
          );
        }
      }
    }
    riderAt.set(r, at);
    await r.call('POST', '/rider/location', at);
    if (!s.online) await r.call('POST', '/rider/status', { online: true }).catch(() => undefined);
  };

  // Delivered orders sometimes get a rating, rarely a complaint.
  const handled = new Set<string>();
  const customerTick = async () => {
    const s = pick(shoppers);
    for (const o of (await s.client.call('GET', '/orders')) as Json[]) {
      if (o.status === 'active') {
        // Answer an unavailable item most of the time; sometimes let the timer remove it.
        const d = await s.client.call('GET', `/orders/${o.id}`);
        for (const c of d.itemChanges as Json[]) {
          if (c.status !== 'pending' || handled.has(c.id)) continue;
          if (Date.now() - new Date(c.createdAt).getTime() < 20_000) continue;
          handled.add(c.id);
          if (Math.random() < 0.25) continue;
          const choice = Math.random() < 0.7 ? 'substitute' : 'remove';
          await s.client.call('POST', `/orders/${o.id}/item-changes/${c.id}`, { choice });
          log(
            s.name.split(' ')[0]!,
            `#${o.reference}: ${choice === 'substitute' ? `took ${c.substitute.name}` : `removed ${c.name}`}`,
          );
        }
      }
      if (o.status !== 'delivered' || handled.has(o.id)) continue;
      handled.add(o.id);
      if (o.canRate && Math.random() < 0.6) {
        await s.client.call('POST', `/orders/${o.id}/ratings`, {
          restaurant: {
            rating: pick([4, 5, 5, 5, 3]),
            tags: [],
            body: pick(['Lovely, still hot.', 'Good portion.', undefined]),
          },
        });
        log(s.name.split(' ')[0]!, `rated #${o.reference}`);
      } else if (Math.random() < 0.08) {
        const form = new FormData();
        form.append('type', pick(['cold_food', 'missing_item']));
        form.append('description', 'Part of the order wasn’t right.');
        await s.client.call('POST', `/orders/${o.id}/problems`, undefined, { form });
        log(s.name.split(' ')[0]!, `reported a problem on #${o.reference}`);
      }
    }
  };

  if (YOU === 'rider' && humanRider) {
    // Look your rider up without signing in as them (that would bind their phone to the simulator).
    const pool = createPool(loadConfig().databaseUrl);
    try {
      const r = await pool.query<{ id: string }>('select id from accounts where username = $1', [
        humanRider.username,
      ]);
      humanRiderId = r.rows[0]?.id ?? null;
    } finally {
      await pool.end();
    }
    log('setup', 'dispatch offers jobs to demo.rider first while you’re online in the app');
  }

  const safe = (who: string, f: () => Promise<unknown>) =>
    f().catch((e) => log('error', `${who}: ${String(e).slice(0, 140)}`));
  while (Date.now() < end) {
    if (Date.now() >= nextOrder) {
      await safe('order', placeOrder);
      nextOrder = Date.now() + EVERY_S * 1000 * (0.5 + Math.random());
    }
    for (const k of kitchens) await safe(k.name, () => kitchenTick(k));
    if (dispatch) await safe('dispatch', () => dispatchTick(dispatch));
    for (const r of ridersAuto) await safe(r.name, () => riderTick(r));
    if (Math.random() < 0.2) await safe('customer', customerTick);
    await sleep(5_000);
  }
  console.log('Simulation finished.');
}

await main();
