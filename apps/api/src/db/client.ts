import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** A database handle or an open transaction (tests pass a transaction they roll back). */
export type Database = Db | Tx;

/**
 * Who a unit of work runs for. Row-level security reads this (see drizzle/0001_rls_and_guards.sql):
 * - platform: customers, riders, dispatchers, the owner, and system jobs. Object-level checks
 *   (own order, own job) happen in the API (SEC-10).
 * - tenant: restaurant staff and owners; the database only shows that restaurant's rows.
 */
export type Scope = { kind: 'platform' } | { kind: 'tenant'; tenantId: string };

export const PLATFORM: Scope = { kind: 'platform' };

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/**
 * Runs `work` in a transaction as the restricted `oyo_app` role with the given scope.
 * The connection's owner role bypasses RLS, so request code must always go through here.
 */
export async function withScope<T>(
  db: Database,
  scope: Scope,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return (db as Db).transaction(async (tx) => {
    await applyScope(tx, scope);
    return work(tx);
  });
}

/** Switches the current transaction to `oyo_app` with the given scope. Lasts until commit. */
export async function applyScope(tx: Tx, scope: Scope): Promise<void> {
  // One statement (one round trip): set_config('role', ..., true) is SET LOCAL ROLE.
  await tx.execute(
    sql`select set_config('role', 'oyo_app', true),
               set_config('app.scope', ${scope.kind}, true),
               set_config('app.tenant_id', ${scope.kind === 'tenant' ? scope.tenantId : ''}, true)`,
  );
}
