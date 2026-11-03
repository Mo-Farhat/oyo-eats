/*
 * Rehearsal setup (development only): makes the demo restaurants live and open all day, and resets
 * a fixed set of logins so every role can be played. Writes the logins to apps/api/.demo/ (git-ignored).
 *
 *   npm run db:seed -w @oyo/api          # restaurants and menus first
 *   npm run demo:setup -w @oyo/api       # then this; safe to run again (new passwords each time)
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Role } from '@oyo/shared';
import { AuthService } from '../auth/auth.service.js';
import { hashPassword, PwnedPasswordsChecker } from '../auth/passwords.js';
import { base32Decode, otpauthUri, timeStep, totpAt } from '../auth/totp.js';
import { encrypt } from '../common/crypto.js';
import { loadConfig } from '../config.js';
import { createDb, createPool, PLATFORM, withScope } from '../db/client.js';
import { accounts, devices, restaurantHours, restaurants, riders, sessions } from '../db/schema.js';
import { ConsoleSmsSender } from '../sms/sms.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

/** Nawalapitiya town centre; demo restaurants are within this radius. */
const TOWN = { lat: 7.049, lng: 80.534 };

export interface DemoLogin {
  username: string;
  password: string;
  role: Role;
  /** Base32, for roles with two-step sign-in. */
  totpSecret?: string;
  restaurant?: string;
  /** Who plays it: you, or the simulator's autopilot. */
  for: 'you' | 'autopilot';
}

interface Wanted {
  username: string;
  displayName: string;
  role: Exclude<Role, 'customer'>;
  restaurant?: string;
  phone?: string;
  plate?: string;
  for: 'you' | 'autopilot';
}

const readable = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(15)]
    .map((b, i) => (i === 5 || i === 10 ? '-' : '') + a[b % a.length])
    .join('');
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);

async function main() {
  const config = loadConfig();
  if (config.env === 'production') throw new Error('demo:setup is for development only');
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  const out: DemoLogin[] = [];
  try {
    await withScope(db, PLATFORM, async (tx) => {
      // 1. Restaurants near town: live, licensed, bank details, open all day, not paused.
      const near = await tx
        .select()
        .from(restaurants)
        .where(
          sql`ST_DWithin(${restaurants.location}::geography, ST_SetSRID(ST_MakePoint(${TOWN.lng}, ${TOWN.lat}), 4326)::geography, 5000)
              and ${restaurants.name} not like 'Riverside Rice%'`,
        );
      for (const r of near) {
        await tx
          .update(restaurants)
          .set({
            status: 'active',
            pausedUntil: null,
            licenceNumber: r.licenceNumber ?? `DEMO-${slug(r.name).toUpperCase()}`,
            licenceExpiresOn: '2027-12-31',
            bankDetailsCiphertext:
              r.bankDetailsCiphertext ??
              encrypt(
                config.encryptionKey,
                JSON.stringify({
                  bankName: 'DEMO BANK (not real)',
                  branch: 'Nawalapitiya',
                  accountName: r.name,
                  accountNumber: '0000 0000',
                }),
              ),
          })
          .where(eq(restaurants.id, r.id));
        await tx.delete(restaurantHours).where(eq(restaurantHours.tenantId, r.id));
        await tx.insert(restaurantHours).values(
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            tenantId: r.id,
            weekday,
            opensAt: '00:00',
            closesAt: '00:00',
          })),
        );
      }
      const hillTop = near.find((r) => r.name.startsWith('Hill Top')) ?? near[0];
      if (!hillTop) throw new Error('No demo restaurants: run npm run db:seed -w @oyo/api first');

      // 2. Logins.
      const wanted: Wanted[] = [
        { username: 'demo.owner', displayName: 'Demo Owner', role: 'owner', for: 'you' },
        {
          username: 'demo.dispatch',
          displayName: 'Demo Dispatcher',
          role: 'dispatcher',
          for: 'you',
        },
        {
          username: 'demo.kitchen',
          displayName: 'Hill Top Kitchen',
          role: 'restaurant_staff',
          restaurant: hillTop.id,
          for: 'you',
        },
        {
          username: 'demo.kitchen.owner',
          displayName: 'Hill Top Owner',
          role: 'restaurant_owner',
          restaurant: hillTop.id,
          for: 'you',
        },
        {
          username: 'demo.rider',
          displayName: 'Kasun Perera',
          role: 'rider',
          phone: '+94770100001',
          plate: 'CP BDE-1001',
          for: 'you',
        },
        {
          username: 'auto.dispatch',
          displayName: 'Autopilot Dispatch',
          role: 'dispatcher',
          for: 'autopilot',
        },
        {
          username: 'auto.rider.1',
          displayName: 'Nuwan Jayasuriya',
          role: 'rider',
          phone: '+94770100011',
          plate: 'CP BDE-1011',
          for: 'autopilot',
        },
        {
          username: 'auto.rider.2',
          displayName: 'Dinesh Silva',
          role: 'rider',
          phone: '+94770100012',
          plate: 'CP BDE-1012',
          for: 'autopilot',
        },
        {
          username: 'auto.rider.3',
          displayName: 'Ruwan Bandara',
          role: 'rider',
          phone: '+94770100013',
          plate: 'CP BDE-1013',
          for: 'autopilot',
        },
        ...near.map((r): Wanted => ({
          username: `auto.kitchen.${slug(r.name)}`,
          displayName: `${r.name} (autopilot)`,
          role: 'restaurant_staff',
          restaurant: r.id,
          for: 'autopilot',
        })),
      ];
      const auth = new AuthService(
        tx,
        { hashKey: config.hashKey, encryptionKey: config.encryptionKey },
        new ConsoleSmsSender(config.env),
        new PwnedPasswordsChecker(),
      );
      for (const w of wanted) {
        const password = readable();
        let [a] = await tx.select().from(accounts).where(eq(accounts.username, w.username));
        if (!a) {
          const created = await auth.createStaffAccount({
            role: w.role,
            username: w.username,
            displayName: w.displayName,
            tenantId: w.restaurant,
          });
          [a] = await tx.select().from(accounts).where(eq(accounts.id, created.accountId));
        }
        await tx
          .update(accounts)
          .set({
            role: w.role,
            displayName: w.displayName,
            tenantId: w.restaurant ?? null,
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
            status: 'active',
            deactivatedAt: null,
            failedLoginCount: 0,
            lockedUntil: null,
            totpSecretCiphertext: null,
            totpPendingSecretCiphertext: null,
            totpLastStep: null,
            ...(w.phone && { phoneCiphertext: encrypt(config.encryptionKey, w.phone) }),
          })
          .where(eq(accounts.id, a!.id));
        if (w.role === 'rider') {
          await tx
            .insert(riders)
            .values({ accountId: a!.id, vehicleType: 'Motorbike', plate: w.plate ?? 'CP BDE-0000' })
            .onConflictDoUpdate({
              target: riders.accountId,
              set: { online: false, paused: false, consecutiveMisses: 0 },
            });
        }
        // Two-step sign-in roles: enrol a fresh authenticator secret.
        let totpSecret: string | undefined;
        const first = await auth.login(
          { username: w.username, password },
          { deviceId: 'demo-setup-0001' },
        );
        if (first.setup.includes('enroll_totp')) {
          const ctx = await auth.authenticate(first.tokens.accessToken);
          const { secret } = await auth.startTotpEnrollment(ctx);
          await auth.confirmTotpEnrollment(
            ctx,
            totpAt(base32Decode(secret), timeStep(new Date())),
            {
              deviceId: 'demo-setup-0001',
            },
          );
          totpSecret = secret;
        }
        // Whoever signs in first (your browser or the autopilot) binds the device.
        await tx.delete(devices).where(eq(devices.accountId, a!.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), revokeReason: 'demo_setup' })
          .where(and(eq(sessions.accountId, a!.id), isNull(sessions.revokedAt)));
        out.push({
          username: w.username,
          password,
          role: w.role,
          totpSecret,
          restaurant: near.find((r) => r.id === w.restaurant)?.name,
          for: w.for,
        });
      }
      console.log(`restaurants live and open all day: ${near.map((r) => r.name).join(', ')}`);
    });
  } finally {
    await pool.end();
  }

  const dir = join(process.cwd(), '.demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'logins.json'), JSON.stringify(out, null, 2));
  const rows = out
    .filter((l) => l.for === 'you')
    .map(
      (l) =>
        `| ${l.role} | \`${l.username}\` | \`${l.password}\` | ${
          l.totpSecret
            ? `[add to authenticator](${otpauthUri(l.totpSecret, l.username)}) · secret \`${l.totpSecret}\``
            : 'none'
        } |`,
    );
  writeFileSync(
    join(dir, 'LOGINS.md'),
    [
      '# Demo logins (development only, regenerated by `npm run demo:setup -w @oyo/api`)',
      '',
      'Staff sign in with **Staff Login**. Roles marked with an authenticator need a 6-digit code: add the secret to Google Authenticator or similar (or open the link on the phone). Customers sign in with any mobile number; the code is printed in the API log.',
      '',
      '| Role | Username | Password | Two-step sign-in |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
      `Autopilot logins (${out.filter((l) => l.for === 'autopilot').length}) are in logins.json; the simulator uses them.`,
      '',
    ].join('\n'),
  );
  console.log(`logins written to ${join(dir, 'LOGINS.md')} (git-ignored)`);
}

await main();
