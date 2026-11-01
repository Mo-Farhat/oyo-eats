import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { accounts, idempotencyKeys, otpChallenges, sessions } from '../db/schema.js';
import { runMaintenance } from './maintenance.js';

afterAll(closeTestDb);

describe.skipIf(!testDatabaseUrl)('runMaintenance', () => {
  it('removes only expired rows', () =>
    inRollback(async (tx) => {
      // Start from empty tables (rolled back afterwards) so other dev data doesn't skew counts.
      await tx.delete(sessions);
      await tx.delete(otpChallenges);
      await tx.delete(idempotencyKeys);
      const now = new Date('2026-11-10T00:00:00Z');
      const day = 24 * 60 * 60 * 1000;
      const ago = (ms: number) => new Date(now.getTime() - ms);
      const [account] = await tx
        .insert(accounts)
        .values({ role: 'customer', displayName: '', phoneHash: `maint-${randomUUID()}` })
        .returning();
      const id = account!.id;

      await tx.insert(idempotencyKeys).values([
        { accountId: id, key: 'expired', requestHash: 'h', expiresAt: ago(1) },
        { accountId: id, key: 'live', requestHash: 'h', expiresAt: new Date(now.getTime() + day) },
      ]);
      await tx.insert(otpChallenges).values([
        { phoneHash: 'p', codeHash: 'c', createdAt: ago(2 * day), expiresAt: ago(2 * day) },
        { phoneHash: 'p', codeHash: 'c', createdAt: ago(60_000), expiresAt: now },
      ]);
      const session = (
        refreshExpiresAt: Date,
        extra: Partial<typeof sessions.$inferInsert> = {},
      ) => ({
        accountId: id,
        familyId: randomUUID(),
        accessTokenHash: randomUUID(),
        refreshTokenHash: randomUUID(),
        accessExpiresAt: refreshExpiresAt,
        refreshExpiresAt,
        ...extra,
      });
      await tx.insert(sessions).values([
        session(ago(8 * day)), // expired over a week ago
        session(new Date(now.getTime() + day), { revokedAt: ago(8 * day) }), // revoked long ago
        session(new Date(now.getTime() + day), { revokedAt: ago(day) }), // revoked recently: kept
        session(new Date(now.getTime() + day)), // live
      ]);

      expect(await runMaintenance(tx, now)).toEqual({
        idempotencyKeys: 1,
        otpChallenges: 1,
        sessions: 2,
      });
      const left = await tx.execute<{ n: string }>(
        sql`select count(*) as n from sessions where account_id = ${id}`,
      );
      expect(Number(left.rows[0]!.n)).toBe(2);
    }));
});
