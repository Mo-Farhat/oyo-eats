import type { ReconciliationRun } from '@oyo/shared';
import { desc, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import { accounts, reconciliationRuns, riders } from '../db/schema.js';
import { cashHeld } from '../dispatch/riders.js';
import { balance } from '../ledger/ledger.js';
import { notify } from '../notifications/direct.js';

type Issue = ReconciliationRun['issues'][number];
const DAY_MS = 86_400_000;

/** The Colombo date before `now`. */
export const yesterdayInColombo = (now = new Date()) =>
  new Date(now.getTime() + 330 * 60_000 - DAY_MS).toISOString().slice(0, 10);

/**
 * PRD section 9, control 2: every night, check that what happened (deliveries, approved transfers,
 * handovers, refunds paid) is in the ledger, and that each rider's cash agrees both ways. Any
 * difference is flagged to the owner.
 */
export class ReconciliationService {
  constructor(private readonly db: Database) {}

  private async checks(tx: Tx, forDate: string): Promise<Issue[]> {
    const start = new Date(`${forDate}T00:00:00+05:30`).toISOString();
    const end = new Date(new Date(`${forDate}T00:00:00+05:30`).getTime() + DAY_MS).toISOString();
    const issues: Issue[] = [];
    const missing = async (
      check: string,
      message: (ref: string) => string,
      query: ReturnType<typeof sql>,
    ) => {
      for (const r of (await tx.execute<{ ref: string }>(query)).rows)
        issues.push({ check, message: message(r.ref), ref: r.ref });
    };
    await missing(
      'delivery_not_in_ledger',
      (ref) => `Delivered order #${ref} has no ledger entry.`,
      sql`select o.reference as ref from orders o
          where o.status = 'delivered' and o.closed_at >= ${start} and o.closed_at < ${end}
            and not exists (select 1 from ledger_transactions t where t.order_id = o.id and t.kind = 'order_delivered')`,
    );
    await missing(
      'rider_pay_not_in_ledger',
      (ref) => `Rider pay for #${ref} isn't in the ledger.`,
      sql`select o.reference as ref from orders o
          join offers f on f.order_id = o.id and f.rider_id = o.rider_id and f.outcome = 'accepted'
          where o.status = 'delivered' and o.closed_at >= ${start} and o.closed_at < ${end}
            and not exists (select 1 from ledger_transactions t where t.order_id = o.id and t.kind = 'rider_pay')`,
    );
    await missing(
      'transfer_not_in_ledger',
      (ref) => `Approved bank transfer for #${ref} isn't in the ledger.`,
      sql`select o.reference as ref from bank_slips b join orders o on o.id = b.order_id
          where b.status = 'approved' and b.reviewed_at >= ${start} and b.reviewed_at < ${end}
            and not exists (select 1 from ledger_transactions t where t.order_id = o.id and t.kind = 'prepayment_received')`,
    );
    await missing(
      'handover_not_in_ledger',
      (ref) => `A cash handover (${ref.slice(0, 8)}) isn't in the ledger.`,
      sql`select h.id::text as ref from cash_handovers h
          where h.recorded_at >= ${start} and h.recorded_at < ${end}
            and not exists (select 1 from ledger_transactions t where t.kind = 'cash_handover' and t.memo = 'handover ' || h.id)`,
    );
    await missing(
      'refund_paid_not_in_ledger',
      (ref) => `Refund paid on #${ref} isn't in the ledger.`,
      sql`select o.reference as ref from refunds r join orders o on o.id = r.order_id
          where r.status = 'paid' and r.paid_at >= ${start} and r.paid_at < ${end}
            and not exists (select 1 from ledger_transactions t where t.kind = 'refund_paid' and t.memo = 'refund ' || r.id)`,
    );
    // Cash two ways: from orders and handovers, and from the ledger.
    const ids = (await tx.select({ id: riders.accountId }).from(riders)).map((r) => r.id);
    const held = await cashHeld(tx, ids);
    const names = ids.length
      ? await tx
          .select({ id: accounts.id, name: accounts.displayName })
          .from(accounts)
          .where(inArray(accounts.id, ids))
      : [];
    for (const id of ids) {
      const ledger = await balance(tx, 'rider_cash', id);
      const ops = held.get(id) ?? 0;
      if (ledger !== ops) {
        issues.push({
          check: 'rider_cash_mismatch',
          message: `${names.find((n) => n.id === id)?.name ?? 'A rider'}: cash from orders is LKR ${ops / 100}, ledger says LKR ${ledger / 100}.`,
          ref: id,
        });
      }
    }
    return issues;
  }

  /** Runs the checks for a day and records the result; flags problems to every owner. */
  run(forDate: string, auth?: AuthContext): Promise<ReconciliationRun> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const issues = await this.checks(tx, forDate);
      const [row] = await tx
        .insert(reconciliationRuns)
        .values({ forDate, ok: issues.length === 0, issues, triggeredBy: auth?.accountId ?? null })
        .returning();
      if (issues.length) {
        const owners = (
          await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(sql`${accounts.role} = 'owner' and ${accounts.status} = 'active'`)
        ).map((a) => a.id);
        await notify(tx, owners, {
          kind: 'reconciliation_issues',
          title: `Books check: ${issues.length} ${issues.length === 1 ? 'difference' : 'differences'}`,
          body: issues[0]!.message,
          critical: false,
        });
      }
      return this.shape(row!);
    });
  }

  latest(): Promise<ReconciliationRun[]> {
    return withScope(this.db, PLATFORM, async (tx) =>
      (
        await tx.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.id)).limit(14)
      ).map((r) => this.shape(r)),
    );
  }

  private shape(r: typeof reconciliationRuns.$inferSelect): ReconciliationRun {
    return {
      id: r.id,
      forDate: r.forDate,
      ok: r.ok,
      issues: r.issues as Issue[],
      triggeredBy: r.triggeredBy,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

export const RECONCILIATION_QUEUE = 'reconciliation.nightly';
