import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import type { Database } from './db/client.js';
import { testConfig } from './db/testing.js';
import { ROUTING, SMS, STORAGE } from './tokens.js';
import { R2Storage } from './storage/r2.js';
import { LocalDiskStorage } from './storage/storage.js';
import { StraightLineRouting } from './routing/routing.js';
import { ConsoleSmsSender } from './sms/sms.js';
import { loadConfig } from './config.js';
import { GoogleRouting } from './routing/google.js';
import { NotifyLkSender } from './sms/notifylk.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('NotifyLkSender', () => {
  it('sends without the plus sign and checks the response', async () => {
    const fetchFake = vi.fn(async () => json(200, { status: 'success', data: 'Sent' }));
    const sms = new NotifyLkSender(
      { userId: 'u1', apiKey: 'k1', senderId: 'OyoEats' },
      fetchFake as typeof fetch,
    );
    await sms.send('+94771234567', 'Your code is 123456');
    const url = new URL(String((fetchFake.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe('https://app.notify.lk/api/v1/send');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      user_id: 'u1',
      sender_id: 'OyoEats',
      to: '94771234567',
    });
  });

  it('throws on a failed send without echoing the message', async () => {
    const sms = new NotifyLkSender({ userId: 'u', apiKey: 'k', senderId: 's' }, (async () =>
      json(200, { status: 'error' })) as typeof fetch);
    await expect(sms.send('+94771234567', 'code 123456')).rejects.toThrow(
      /^Notify\.lk send failed \(HTTP 200\)$/,
    );
  });
});

describe('GoogleRouting', () => {
  it('reads the route distance, caches it, and falls back when Google fails', async () => {
    let now = 0;
    const fetchFake = vi.fn(async () => json(200, { routes: [{ distanceMeters: 2345 }] }));
    const routing = new GoogleRouting('key', fetchFake as typeof fetch, () => now);
    const a = { lat: 7.049, lng: 80.534 };
    const b = { lat: 7.059, lng: 80.534 };
    expect(await routing.routeMeters(a, b)).toBe(2345);
    expect(await routing.routeMeters(a, b)).toBe(2345);
    expect(fetchFake).toHaveBeenCalledTimes(1);
    const init = (fetchFake.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'routes.distanceMeters',
    );
    now = 11 * 60_000;
    await routing.routeMeters(a, b);
    expect(fetchFake).toHaveBeenCalledTimes(2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = new GoogleRouting('key', (async () => json(403, { error: {} })) as typeof fetch);
    expect(await down.routeMeters(a, b)).toBe(Math.round(1112 * 1.3));
    expect(warn).toHaveBeenCalled();
  });
});

describe('loadConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const base = () => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.HASH_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
    for (const k of Object.keys(process.env))
      if (/^(R2_|NOTIFYLK_|PUBLIC_URL|GOOGLE_ROUTES)/.test(k)) delete process.env[k];
  };

  it('rejects a half-configured provider', () => {
    base();
    process.env.R2_ACCOUNT_ID = 'a';
    expect(() => loadConfig()).toThrow(/all or none of: R2_ACCOUNT_ID/);
  });

  it('refuses to start production without storage, SMS and a public URL', () => {
    base();
    process.env.NODE_ENV = 'production';
    expect(() => loadConfig()).toThrow(/Production needs: R2_\*, NOTIFYLK_\*, PUBLIC_URL/);
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'a',
      R2_ACCESS_KEY_ID: 'b',
      R2_SECRET_ACCESS_KEY: 'c',
      R2_BUCKET: 'd',
      NOTIFYLK_USER_ID: 'u',
      NOTIFYLK_API_KEY: 'k',
      NOTIFYLK_SENDER_ID: 's',
      PUBLIC_URL: 'https://api.example.lk',
    });
    expect(loadConfig()).toMatchObject({
      env: 'production',
      r2: { bucket: 'd' },
      notifyLk: { senderId: 's' },
    });
  });
});

describe('provider selection in the app', () => {
  const build = (extra: object) =>
    NestFactory.createApplicationContext(
      AppModule.forRoot(
        { ...testConfig(), env: 'development', ...extra },
        { db: {} as Database, jobs: false },
      ),
      { logger: false, abortOnError: false },
    );

  it('uses R2, Notify.lk and Google Routes when configured', async () => {
    const app = await build({
      r2: { accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' },
      notifyLk: { userId: 'u', apiKey: 'k', senderId: 's' },
      googleRoutesKey: 'g',
    });
    expect(app.get(STORAGE)).toBeInstanceOf(R2Storage);
    expect(app.get(SMS)).toBeInstanceOf(NotifyLkSender);
    expect(app.get(ROUTING)).toBeInstanceOf(GoogleRouting);
    await app.close();
  });

  it('falls back to local disk, console SMS and straight-line distance', async () => {
    const app = await build({});
    expect(app.get(STORAGE)).toBeInstanceOf(LocalDiskStorage);
    expect(app.get(SMS)).toBeInstanceOf(ConsoleSmsSender);
    expect(app.get(ROUTING)).toBeInstanceOf(StraightLineRouting);
    await app.close();
  });
});
