/*
 * Seed: settings defaults and the owner account (every environment), plus demo restaurants and
 * one demo account per face outside production. Safe to re-run: existing rows are skipped.
 * New accounts get one-time passwords, printed once; first sign-in forces a change.
 *
 *   npm run db:seed -w @oyo/api
 */
import { SETTINGS_SEED_DEFAULTS } from '@oyo/shared';
import { eq, sql } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { PwnedPasswordsChecker } from '../auth/passwords.js';
import { loadConfig } from '../config.js';
import { ConsoleSmsSender } from '../sms/sms.js';
import { createDb, createPool, PLATFORM, withScope, type Tx } from './client.js';
import {
  accounts,
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  restaurantHours,
  restaurants,
  riders,
  settings,
} from './schema.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

interface DemoItem {
  name: string;
  description?: string;
  priceCents: number;
  soldOut?: boolean;
  dietaryTags?: string[];
  groups?: { name: string; min: number; max: number; options: [string, number][] }[];
}

interface DemoRestaurant {
  name: string;
  addressText: string;
  lng: number;
  lat: number;
  ownerUsername?: string;
  cuisines: string[];
  menu: Record<string, DemoItem[]>;
}

const SPICE = {
  name: 'Spice level',
  min: 1,
  max: 1,
  options: [
    ['Mild', 0],
    ['Medium', 0],
    ['Hot', 0],
  ] as [string, number][],
};

// Demo data only, placed in the Nawalapitiya pilot zone. "Hill Top Kottu House" matches the design canvas (C04).
const DEMO_RESTAURANTS: DemoRestaurant[] = [
  {
    name: 'Hill Top Kottu House',
    addressText: 'Main Street, Nawalapitiya',
    lng: 80.534,
    lat: 7.049,
    ownerUsername: 'demo.hilltop',
    cuisines: ['Kottu', 'Fried Rice', 'Devilled'],
    menu: {
      Kottu: [
        {
          name: 'Chicken Cheese Kottu',
          description: 'Shredded roti, chicken curry, mozzarella',
          priceCents: 135_000,
          groups: [
            SPICE,
            {
              name: 'Add-ons',
              min: 0,
              max: 2,
              options: [
                ['Extra cheese', 15_000],
                ['Fried egg', 10_000],
              ],
            },
          ],
        },
        {
          name: 'Dolphin Kottu',
          description: 'Thin-cut roti, egg, gravy on the side',
          priceCents: 120_000,
          groups: [SPICE],
        },
        {
          name: 'Mutton Kottu',
          description: 'Slow-cooked mutton, leeks',
          priceCents: 165_000,
          soldOut: true,
        },
      ],
      'Fried Rice': [{ name: 'Chicken Fried Rice', priceCents: 110_000, groups: [SPICE] }],
      Devilled: [{ name: 'Devilled Chicken', priceCents: 140_000 }],
      Drinks: [
        { name: 'Iced Milo', priceCents: 45_000 },
        { name: 'Lime Juice', priceCents: 35_000, dietaryTags: ['vegan'] },
      ],
    },
  },
  {
    name: 'Lotus Rice & Curry',
    addressText: 'Gampola Road, Nawalapitiya',
    lng: 80.5395,
    lat: 7.0525,
    cuisines: ['Rice & Curry'],
    menu: {
      'Rice & Curry': [
        { name: 'Chicken Rice & Curry', priceCents: 95_000 },
        { name: 'Fish Rice & Curry', priceCents: 105_000 },
        { name: 'Vegetable Rice & Curry', priceCents: 75_000, dietaryTags: ['vegetarian'] },
      ],
      Sides: [{ name: 'Papadam (3)', priceCents: 15_000, dietaryTags: ['vegan'] }],
    },
  },
  {
    name: 'Station Road Short Eats',
    addressText: 'Station Road, Nawalapitiya',
    lng: 80.5305,
    lat: 7.0462,
    cuisines: ['Short Eats', 'Bakery'],
    menu: {
      'Short Eats': [
        { name: 'Fish Bun', priceCents: 15_000 },
        { name: 'Chicken Roll', priceCents: 22_000 },
        { name: 'Vegetable Roti', priceCents: 18_000, dietaryTags: ['vegetarian'] },
      ],
    },
  },
];

/** The business account customers pay into (from the business, 2026-11-02). */
const BUSINESS_BANK = {
  bankName: 'Commercial Bank',
  branch: 'Nawalapitiya',
  accountName: 'Oyo Eats',
  accountNumber: '1000857557',
};

async function seedSettings(tx: Tx) {
  const rows = Object.entries(SETTINGS_SEED_DEFAULTS).map(([key, value]) => ({ key, value }));
  const inserted = await tx
    .insert(settings)
    .values(rows)
    .onConflictDoNothing()
    .returning({ key: settings.key });
  // Rider pay changed shape (base + per km -> share of the fee); replace the old placeholder.
  await tx
    .update(settings)
    .set({ value: SETTINGS_SEED_DEFAULTS.riderPay })
    .where(sql`${settings.key} = 'riderPay' and not ${settings.value} ? 'platformShareBps'`);
  console.log(
    `settings: ${inserted.length ? `added ${inserted.map((r) => r.key).join(', ')}` : 'already present'}`,
  );
}

async function exists(tx: Tx, username: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(sql`lower(${accounts.username}) = lower(${username})`);
  return row?.id;
}

const created: { username: string; role: string; password: string }[] = [];

async function seedAccount(
  tx: Tx,
  auth: AuthService,
  input: Parameters<AuthService['createStaffAccount']>[0],
): Promise<string> {
  const existing = await exists(tx, input.username);
  if (existing) return existing;
  const { accountId, temporaryPassword } = await auth.createStaffAccount(input);
  created.push({ username: input.username, role: input.role, password: temporaryPassword });
  return accountId;
}

async function seedRestaurant(tx: Tx, auth: AuthService, demo: DemoRestaurant) {
  let [restaurant] = await tx.select().from(restaurants).where(eq(restaurants.name, demo.name));
  if (!restaurant) {
    [restaurant] = await tx
      .insert(restaurants)
      .values({
        name: demo.name,
        status: 'active',
        location: { x: demo.lng, y: demo.lat },
        addressText: demo.addressText,
        cuisines: demo.cuisines,
        licenceNumber: `DEMO-${demo.name.slice(0, 3).toUpperCase()}`,
        licenceExpiresOn: '2027-12-31',
        subscriptionStatus: 'active',
      })
      .returning();
    const tenantId = restaurant!.id;
    await tx.insert(restaurantHours).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        tenantId,
        weekday,
        opensAt: '08:00',
        closesAt: '23:00',
      })),
    );
    let sortOrder = 0;
    for (const [categoryName, items] of Object.entries(demo.menu)) {
      const [category] = await tx
        .insert(menuCategories)
        .values({ tenantId, name: categoryName, sortOrder: sortOrder++ })
        .returning();
      for (const item of items) {
        const [menuItem] = await tx
          .insert(menuItems)
          .values({
            tenantId,
            categoryId: category!.id,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            soldOut: item.soldOut ?? false,
            dietaryTags: item.dietaryTags ?? [],
            approvalStatus: 'approved',
          })
          .returning();
        for (const [i, group] of (item.groups ?? []).entries()) {
          const [g] = await tx
            .insert(modifierGroups)
            .values({
              tenantId,
              menuItemId: menuItem!.id,
              name: group.name,
              minSelect: group.min,
              maxSelect: group.max,
              sortOrder: i,
            })
            .returning();
          await tx.insert(modifiers).values(
            group.options.map(([name, priceCents]) => ({
              tenantId,
              groupId: g!.id,
              name,
              priceCents,
            })),
          );
        }
      }
    }
    console.log(`restaurant: added ${demo.name}`);
  }
  if (demo.ownerUsername) {
    await seedAccount(tx, auth, {
      role: 'restaurant_owner',
      username: demo.ownerUsername,
      displayName: `${demo.name} owner`,
      tenantId: restaurant!.id,
    });
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  try {
    await withScope(db, PLATFORM, async (tx) => {
      // AuthService runs inside this transaction, so the whole seed commits or nothing does.
      const auth = new AuthService(
        tx,
        { hashKey: config.hashKey, encryptionKey: config.encryptionKey },
        new ConsoleSmsSender(config.env),
        new PwnedPasswordsChecker(),
      );
      await seedSettings(tx);
      // Where customers send bank transfers (CUS-09). Later edits in settings win.
      await tx
        .insert(settings)
        .values({ key: 'bankDetails', value: BUSINESS_BANK })
        .onConflictDoNothing();
      await seedAccount(tx, auth, {
        role: 'owner',
        username: process.env.SEED_OWNER_USERNAME ?? 'owner',
        displayName: 'Owner',
      });

      if (config.env === 'production') return;

      for (const demo of DEMO_RESTAURANTS) await seedRestaurant(tx, auth, demo);
      await seedAccount(tx, auth, {
        role: 'dispatcher',
        username: 'demo.dispatcher',
        displayName: 'Demo Dispatcher',
      });
      const riderId = await seedAccount(tx, auth, {
        role: 'rider',
        username: 'demo.rider',
        displayName: 'Demo Rider',
      });
      await tx
        .insert(riders)
        .values({ accountId: riderId, vehicleType: 'motorbike', plate: 'WP BCD-1234' })
        .onConflictDoNothing();
    });
  } finally {
    await pool.end();
  }

  if (created.length === 0) {
    console.log('accounts: all present (passwords were shown when they were created)');
    return;
  }
  console.log('\nNew accounts. Passwords are shown once; first sign-in forces a change:');
  for (const a of created)
    console.log(`  ${a.role.padEnd(17)} ${a.username.padEnd(18)} ${a.password}`);
}

await main();
