/*
 * HTTP-level checks of the access rules and idempotency, on the real app wired to a
 * rolled-back transaction. A test-only controller provides one route per rule.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { ACCESS_RULES, CurrentAuth, RequirePermission, SignedIn } from './auth/decorators.js';
import type { AuthContext } from './auth/auth.service.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { Idempotent } from './common/idempotency.js';
import type { Tx } from './db/client.js';
import { accounts, auditLog } from './db/schema.js';
import { closeTestDb, inRollback, testConfig, testDatabaseUrl } from './db/testing.js';
import { DB } from './tokens.js';

afterAll(closeTestDb);

@Controller('probe')
class ProbeController {
  constructor(@Inject(DB) private readonly db: Tx) {}

  @Get('rider')
  @RequirePermission('job.view_own')
  rider() {
    return { ok: true };
  }

  @Get('admin')
  @RequirePermission('orders.assign')
  admin() {
    return { ok: true };
  }

  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Post('charge')
  @SignedIn()
  @Idempotent()
  @HttpCode(201)
  async charge(@CurrentAuth() auth: AuthContext, @Body() body: { amountCents: number }) {
    await this.db.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action: 'probe.charge',
      targetType: 'probe',
      after: body,
    });
    return { charged: body.amountCents, at: Date.now() };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function withApp(tx: Tx, work: (http: Http, app: INestApplication) => Promise<void>) {
  const app = await NestFactory.create(
    AppModule.forRoot(testConfig(), { db: tx, jobs: false, imports: [ProbeModule] }),
    { logger: false },
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
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return {
      status: res.status,
      body: await res.json().catch(() => null),
      replayed: res.headers.get('idempotent-replayed'),
    };
  };
  try {
    await work(http, app);
  } finally {
    await app.close();
  }
}

type Http = (
  method: string,
  path: string,
  opts?: { token?: string; key?: string; body?: unknown },
) => Promise<{
  status: number;
  body: unknown;
  replayed: string | null;
}>;

/** A rider who has already changed their password, signed in on one device. */
async function riderToken(app: INestApplication, tx: Tx, setupDone = true): Promise<string> {
  const auth = app.get(AuthService);
  const { accountId, temporaryPassword } = await auth.createStaffAccount({
    role: 'rider',
    username: `rider.${Math.random().toString(36).slice(2, 8)}`,
    displayName: 'Probe Rider',
  });
  if (setupDone)
    await tx.update(accounts).set({ mustChangePassword: false }).where(eq(accounts.id, accountId));
  const [row] = await tx
    .select({ username: accounts.username })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  const result = await auth.login(
    { username: row!.username!, password: temporaryPassword },
    { deviceId: 'probe-device-0001' },
  );
  return result.tokens.accessToken;
}

describe.skipIf(!testDatabaseUrl)('access rules over HTTP', () => {
  it('applies permissions, refuses undeclared routes and limited sessions', () =>
    inRollback((tx) =>
      withApp(tx, async (http, app) => {
        const token = await riderToken(app, tx);
        expect((await http('GET', '/probe/rider', { token })).status).toBe(200);
        expect(await http('GET', '/probe/admin', { token })).toMatchObject({
          status: 403,
          body: { error: 'forbidden' },
        });
        expect(await http('GET', '/probe/undeclared', { token })).toMatchObject({
          status: 403,
          body: { error: 'forbidden' },
        });
        expect(await http('GET', '/probe/rider')).toMatchObject({
          status: 401,
          body: { error: 'invalid_token' },
        });

        const limited = await riderToken(app, tx, false);
        expect(await http('GET', '/probe/rider', { token: limited })).toMatchObject({
          status: 403,
          body: { error: 'setup_required' },
        });
        expect((await http('GET', '/auth/me', { token: limited })).status).toBe(200);
      }),
    ));

  it('every real route declares an access rule', () =>
    inRollback((tx) =>
      withApp(tx, async (_http, app) => {
        const missing: string[] = [];
        for (const module of app.get(ModulesContainer).values()) {
          for (const { metatype } of module.controllers.values()) {
            if (!metatype || metatype === ProbeController) continue;
            const controller = metatype as new (...args: never[]) => object;
            for (const name of Object.getOwnPropertyNames(controller.prototype)) {
              const handler = (controller.prototype as Record<string, unknown>)[name];
              if (name === 'constructor' || typeof handler !== 'function') continue;
              if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
              const declared = ACCESS_RULES.some(
                (rule) =>
                  Reflect.getMetadata(rule, handler) !== undefined ||
                  Reflect.getMetadata(rule, controller) !== undefined,
              );
              if (!declared) missing.push(`${controller.name}.${name}`);
            }
          }
        }
        expect(missing).toEqual([]);
        // The check itself works: the probe's undeclared route would be caught.
        expect(
          Reflect.getMetadata(ACCESS_RULES[0], ProbeController.prototype.undeclared),
        ).toBeUndefined();
      }),
    ));
});

describe.skipIf(!testDatabaseUrl)('idempotency over HTTP', () => {
  it('runs once per key, replays retries and refuses a changed body', () =>
    inRollback((tx) =>
      withApp(tx, async (http, app) => {
        const token = await riderToken(app, tx);
        const count = async () =>
          Number(
            (
              await tx.execute<{ n: string }>(
                sql`select count(*) as n from audit_log where action = 'probe.charge'`,
              )
            ).rows[0]!.n,
          );

        expect(
          await http('POST', '/probe/charge', { token, body: { amountCents: 100 } }),
        ).toMatchObject({
          status: 400,
          body: { error: 'idempotency_key_required' },
        });

        const first = await http('POST', '/probe/charge', {
          token,
          key: 'key-0000-0001',
          body: { amountCents: 100 },
        });
        const retry = await http('POST', '/probe/charge', {
          token,
          key: 'key-0000-0001',
          body: { amountCents: 100 },
        });
        expect(first).toMatchObject({ status: 201, replayed: null });
        expect(retry).toMatchObject({ status: 201, replayed: 'true', body: first.body });
        expect(await count()).toBe(1);

        expect(
          await http('POST', '/probe/charge', {
            token,
            key: 'key-0000-0001',
            body: { amountCents: 999 },
          }),
        ).toMatchObject({
          status: 422,
          body: { error: 'idempotency_key_reused' },
        });
        expect(
          (
            await http('POST', '/probe/charge', {
              token,
              key: 'key-0000-0002',
              body: { amountCents: 100 },
            })
          ).status,
        ).toBe(201);
        expect(await count()).toBe(2);
      }),
    ));
});
