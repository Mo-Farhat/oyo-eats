/*
 * HTTP test harness: the real app on a rolled-back transaction, with captured SMS, recorded jobs
 * and straight-line routing. Use inside inRollback() (src/db/testing.ts).
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplication, Type } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { ApiErrorFilter } from '../common/api-error.filter.js';
import type { Tx } from '../db/client.js';
import { testConfig } from '../db/testing.js';
import { RecordingJobQueue } from '../jobs/queue.js';
import { AuthService } from '../auth/auth.service.js';
import { base32Decode, timeStep, totpAt } from '../auth/totp.js';
import { accounts } from '../db/schema.js';
import type { FileStorage } from '../storage/storage.js';
import { eq } from 'drizzle-orm';
import type { Role } from '@oyo/shared';

export interface HttpResult {
  status: number;
  // Tests read nested fields freely; responses are checked with expect().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}

export type Http = (
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown; key?: string; headers?: Record<string, string> },
) => Promise<HttpResult>;

/** In-memory FileStorage for tests. */
export class MemoryStorage implements FileStorage {
  readonly files = new Map<string, { data: Buffer; contentType: string }>();
  async put(key: string, data: Buffer, contentType: string) {
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async signedUrl(key: string, ttlSeconds: number) {
    return `memory://${key}?ttl=${ttlSeconds}`;
  }
}

export interface Harness {
  app: INestApplication;
  http: Http;
  jobs: RecordingJobQueue;
  storage: MemoryStorage;
  /** Multipart POST with one file field and optional text fields. */
  upload(
    path: string,
    token: string,
    field: string,
    file: Buffer,
    fields?: Record<string, string>,
  ): Promise<HttpResult>;
  /** A staff account signed in with a full session (password changed, 2FA enrolled if needed). */
  staff(role: Exclude<Role, 'customer'>, tenantId?: string): Promise<string>;
  /** Last SMS text sent to a number. */
  lastSms(phone: string): string | undefined;
  /** Signs a customer in through the real OTP flow and returns the access token. */
  customer(phone: string): Promise<string>;
}

export async function withHarness(
  tx: Tx,
  work: (h: Harness) => Promise<void>,
  imports: Type[] = [],
) {
  const sms = new Map<string, string>();
  const jobs = new RecordingJobQueue();
  const storage = new MemoryStorage();
  const app = await NestFactory.create(
    AppModule.forRoot(testConfig(), {
      db: tx,
      jobs: false,
      recorder: jobs,
      sms: { send: async (phone, text) => void sms.set(phone, text) },
      storage,
      imports,
    }),
    // TEST_LOG=1 prints server errors behind a 500.
    { logger: process.env.TEST_LOG ? ['error'] : false, abortOnError: false },
  );
  app.useGlobalFilters(new ApiErrorFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const http: Http = async (method, path, opts = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.key ? { 'idempotency-key': opts.key } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const json = res.headers.get('content-type')?.includes('json');
    return {
      status: res.status,
      body: text ? (json ? JSON.parse(text) : text) : null,
      headers: res.headers,
    };
  };

  const customer = async (phone: string) => {
    await http('POST', '/auth/otp/request', { body: { phone } });
    const code = sms.get(phone)?.match(/\d{6}/)?.[0];
    const res = await http('POST', '/auth/otp/verify', {
      body: { phone, code, acceptTerms: true },
    });
    if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.body)}`);
    return res.body.tokens.accessToken as string;
  };

  const upload: Harness['upload'] = async (path, token, field, file, fields = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(field, new Blob([new Uint8Array(file)]), 'slip.jpg');
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  let staffCount = 0;
  const staff: Harness['staff'] = async (role, tenantId) => {
    const auth = app.get(AuthService);
    const username = `test.${role}.${++staffCount}.${Date.now() % 100000}`;
    const { accountId, temporaryPassword } = await auth.createStaffAccount({
      role,
      username,
      displayName: `Test ${role}`,
      tenantId,
    });
    await tx.update(accounts).set({ mustChangePassword: false }).where(eq(accounts.id, accountId));
    const meta = { deviceId: `test-device-${staffCount}-0000` };
    let result = await auth.login({ username, password: temporaryPassword }, meta);
    if (result.setup.includes('enroll_totp')) {
      const ctx = await auth.authenticate(result.tokens.accessToken);
      const { secret } = await auth.startTotpEnrollment(ctx);
      result = await auth.confirmTotpEnrollment(
        ctx,
        totpAt(base32Decode(secret), timeStep(new Date())),
        meta,
      );
    }
    return result.tokens.accessToken;
  };

  try {
    await work({ app, http, jobs, storage, upload, staff, lastSms: (p) => sms.get(p), customer });
  } finally {
    await app.close();
  }
}

/**
 * An always-open restaurant with a small menu at the given point. Far from the seeded demo
 * restaurants by default (Jaffna), so lists only contain fixtures.
 */
export async function fixtureRestaurant(
  tx: Tx,
  at = { lat: 9.6615, lng: 80.0255 },
  name = 'Fixture Kitchen',
) {
  const [r] = (
    await tx.execute<{ id: string }>(sql`
      insert into restaurants (name, status, location, address_text, cuisines, licence_number, licence_expires_on, prep_minutes)
      values (${name}, 'active', ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326), 'Test Road', '{Kottu,Rice}', 'LIC-1', '2099-12-31', 20)
      returning id`)
  ).rows;
  const tenantId = r!.id;
  await tx.execute(sql`
    insert into restaurant_hours (tenant_id, weekday, opens_at, closes_at)
    select ${tenantId}, d, '00:00', '00:00' from generate_series(0, 6) d`);
  const [cat] = (
    await tx.execute<{ id: string }>(sql`
      insert into menu_categories (tenant_id, name) values (${tenantId}, 'Kottu') returning id`)
  ).rows;
  const item = async (itemName: string, price: number, soldOut = false) =>
    (
      await tx.execute<{ id: string }>(sql`
        insert into menu_items (tenant_id, category_id, name, price_cents, sold_out, approval_status)
        values (${tenantId}, ${cat!.id}, ${itemName}, ${price}, ${soldOut}, 'approved') returning id`)
    ).rows[0]!.id;
  const kottu = await item('Chicken Kottu', 135_000);
  const soldOut = await item('Mutton Kottu', 165_000, true);
  const pending = (
    await tx.execute<{ id: string }>(sql`
      insert into menu_items (tenant_id, category_id, name, price_cents, approval_status)
      values (${tenantId}, ${cat!.id}, 'Unapproved Kottu', 100000, 'pending') returning id`)
  ).rows[0]!.id;
  const group = async (groupName: string, min: number, max: number) =>
    (
      await tx.execute<{ id: string }>(sql`
        insert into modifier_groups (tenant_id, menu_item_id, name, min_select, max_select)
        values (${tenantId}, ${kottu}, ${groupName}, ${min}, ${max}) returning id`)
    ).rows[0]!.id;
  const spice = await group('Spice level', 1, 1);
  const addons = await group('Add-ons', 0, 2);
  const option = async (groupId: string, optionName: string, price: number) =>
    (
      await tx.execute<{ id: string }>(sql`
        insert into modifiers (tenant_id, group_id, name, price_cents) values (${tenantId}, ${groupId}, ${optionName}, ${price}) returning id`)
    ).rows[0]!.id;
  return {
    tenantId,
    point: at,
    items: { kottu, soldOut, pending },
    modifiers: {
      mild: await option(spice, 'Mild', 0),
      hot: await option(spice, 'Hot', 0),
      cheese: await option(addons, 'Extra cheese', 15_000),
      egg: await option(addons, 'Fried egg', 10_000),
    },
  };
}
