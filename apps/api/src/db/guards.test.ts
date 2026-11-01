/*
 * Integration tests for the database guards in drizzle/0001_rls_and_guards.sql, run against the
 * DATABASE_URL database. Each test runs in a transaction that is rolled back, so nothing persists.
 * Skipped when DATABASE_URL is not set.
 */
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { applyScope, createDb, createPool, type Tx } from './client.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

const url = process.env.DATABASE_URL;
const pool = url ? createPool(url) : undefined;
const db = pool ? createDb(pool) : undefined;

afterAll(async () => {
  await pool?.end();
});

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const CUSTOMER = '00000000-0000-7000-8000-0000000000c1';
const ORDER = '00000000-0000-7000-8000-0000000000d1';

/** Runs `work` with fixtures inserted (as the owner role), then rolls everything back. */
async function inRollback(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db!.transaction(async (tx) => {
      await tx.execute(sql`
        insert into restaurants (id, name, location, address_text) values
          (${A}, 'A', ST_MakePoint(79.86, 6.92), 'Colombo'),
          (${B}, 'B', ST_MakePoint(79.87, 6.93), 'Colombo')`);
      await tx.execute(sql`
        insert into menu_categories (id, tenant_id, name) values
          ('00000000-0000-7000-8000-0000000000aa', ${A}, 'Kottu'),
          ('00000000-0000-7000-8000-0000000000bb', ${B}, 'Rice')`);
      await tx.execute(sql`
        insert into menu_items (tenant_id, category_id, name, price_cents) values
          (${A}, '00000000-0000-7000-8000-0000000000aa', 'A item', 135000),
          (${B}, '00000000-0000-7000-8000-0000000000bb', 'B item', 120000)`);
      await tx.execute(sql`
        insert into accounts (id, role, display_name, phone_hash)
          values (${CUSTOMER}, 'customer', 'Test', 'hash-c1')`);
      await tx.execute(sql`
        insert into orders (id, tenant_id, reference, customer_id, payment_method, status,
          delivery_location, route_distance_meters, fee_settings, items_cents, delivery_fee_cents,
          total_cents)
        values (${ORDER}, ${A}, 'TEST-1', ${CUSTOMER}, 'cod', 'awaiting_restaurant',
          ST_MakePoint(79.88, 6.94), 2000, '{}', 135000, 26000, 161000)`);
      await work(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

/**
 * Expects `work` to fail inside a savepoint, so the outer transaction stays usable. Drizzle wraps
 * Postgres errors, so the match runs over the message and its cause.
 */
async function expectFailure(tx: Tx, work: (sp: Tx) => Promise<unknown>, message: RegExp) {
  await expect(tx.transaction(async (sp) => void (await work(sp)))).rejects.toSatisfy((error) =>
    message.test(errorText(error)),
  );
}

const names = async (tx: Tx, table: 'menu_items' | 'restaurants') =>
  (
    await tx.execute<{ name: string }>(sql`select name from ${sql.identifier(table)} order by name`)
  ).rows.map((r) => r.name);

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.message} ${String((error as { cause?: unknown }).cause)}`
    : '';
}

describe.skipIf(!url)('row-level security', () => {
  it('shows a restaurant only its own rows', () =>
    inRollback(async (tx) => {
      await applyScope(tx, { kind: 'tenant', tenantId: A });
      expect(await names(tx, 'menu_items')).toEqual(['A item']);
      expect(await names(tx, 'restaurants')).toEqual(['A']);
    }));

  it('shows the platform every tenant', () =>
    inRollback(async (tx) => {
      await applyScope(tx, { kind: 'platform' });
      // Only the fixture tenants: the dev database may also hold seeded demo restaurants.
      const rows = await tx.execute<{ name: string }>(
        sql`select name from menu_items where tenant_id in (${A}, ${B}) order by name`,
      );
      expect(rows.rows.map((r) => r.name)).toEqual(['A item', 'B item']);
    }));

  it('shows nothing when no scope is set', () =>
    inRollback(async (tx) => {
      await tx.execute(sql`set local role oyo_app`);
      expect(await names(tx, 'menu_items')).toEqual([]);
      expect(await names(tx, 'restaurants')).toEqual([]);
    }));

  it("stops a restaurant writing or changing another restaurant's rows", () =>
    inRollback(async (tx) => {
      await applyScope(tx, { kind: 'tenant', tenantId: A });
      await expectFailure(
        tx,
        (sp) =>
          sp.execute(sql`insert into menu_items (tenant_id, category_id, name, price_cents)
            values (${B}, '00000000-0000-7000-8000-0000000000bb', 'sneaky', 100)`),
        /row-level security/,
      );
      const updated = await tx.execute(
        sql`update menu_items set price_cents = 1 where tenant_id = ${B}`,
      );
      expect(updated.rowCount).toBe(0);
    }));

  it('keeps platform tables away from restaurants', () =>
    inRollback(async (tx) => {
      await applyScope(tx, { kind: 'tenant', tenantId: A });
      const rows = await tx.execute(sql`select 1 from accounts where id = ${CUSTOMER}`);
      expect(rows.rowCount).toBe(0);
      await expectFailure(
        tx,
        (sp) => sp.execute(sql`insert into settings (key, value) values ('x', '1')`),
        /row-level security/,
      );
    }));
});

describe.skipIf(!url)('append-only and money guards', () => {
  it('lets order events be added but never changed, even by the owner role', () =>
    inRollback(async (tx) => {
      await tx.execute(sql`insert into order_events (tenant_id, order_id, type, actor_role)
        values (${A}, ${ORDER}, 'placed', 'customer')`);
      await expectFailure(
        tx,
        (sp) => sp.execute(sql`update order_events set type = 'x'`),
        /append-only/,
      );
      await expectFailure(tx, (sp) => sp.execute(sql`delete from order_events`), /append-only/);
    }));

  it('denies the app role update and delete on the audit log', () =>
    inRollback(async (tx) => {
      await applyScope(tx, { kind: 'platform' });
      await tx.execute(sql`insert into audit_log (actor_role, action, target_type)
        values ('owner', 'settings.edit', 'settings')`);
      await expectFailure(tx, (sp) => sp.execute(sql`delete from audit_log`), /permission denied/);
    }));

  it('rejects an unbalanced ledger transaction at commit', () =>
    inRollback(async (tx) => {
      const unbalanced = async (sp: Tx) => {
        const [txn] = (
          await sp.execute<{ id: string }>(
            sql`insert into ledger_transactions (kind) values ('test') returning id`,
          )
        ).rows;
        await sp.execute(sql`insert into ledger_entries (transaction_id, account, amount_cents)
          values (${txn!.id}, 'rider_cash', 161000), (${txn!.id}, 'restaurant_payable', -135000)`);
        await sp.execute(sql`set constraints ledger_balanced immediate`);
      };
      await expect(tx.transaction(unbalanced)).rejects.toSatisfy((e) =>
        /does not balance/.test(errorText(e)),
      );
    }));

  it('accepts a balanced ledger transaction', () =>
    inRollback(async (tx) => {
      const [txn] = (
        await tx.execute<{ id: string }>(
          sql`insert into ledger_transactions (kind) values ('cod_delivered') returning id`,
        )
      ).rows;
      await tx.execute(sql`insert into ledger_entries (transaction_id, account, amount_cents) values
        (${txn!.id}, 'rider_cash', 161000),
        (${txn!.id}, 'restaurant_payable', -135000),
        (${txn!.id}, 'delivery_fee_revenue', -26000)`);
      await tx.execute(sql`set constraints ledger_balanced immediate`);
    }));

  it('freezes a settlement once it is paid', () =>
    inRollback(async (tx) => {
      const [s] = (
        await tx.execute<{ id: string }>(sql`insert into settlements
          (party, party_id, tenant_id, period_start, period_end, total_cents, status, checksum)
          values ('restaurant', ${A}, ${A}, '2026-11-02', '2026-11-08', 135000, 'paid', 'abc')
          returning id`)
      ).rows;
      await expectFailure(
        tx,
        (sp) => sp.execute(sql`update settlements set total_cents = 1 where id = ${s!.id}`),
        /is paid/,
      );
      await expectFailure(
        tx,
        (sp) =>
          sp.execute(sql`insert into settlement_lines (settlement_id, tenant_id, description, amount_cents)
            values (${s!.id}, ${A}, 'late line', 100)`),
        /is paid/,
      );
    }));

  it('rejects an order whose total does not add up', () =>
    inRollback(async (tx) => {
      await expectFailure(
        tx,
        (sp) =>
          sp.execute(sql`update orders set total_cents = total_cents + 1 where id = ${ORDER}`),
        /total_adds_up/,
      );
    }));
});
