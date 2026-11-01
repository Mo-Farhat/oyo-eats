import { createHash } from 'node:crypto';
import type {
  BankDetails,
  GenerateSettlementsInput,
  SettlementDetail,
  SettlementSummary,
} from '@oyo/shared';
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  offers,
  orders,
  restaurants,
  settlementLines,
  settlements,
} from '../db/schema.js';
import { postSettlementPaid } from '../ledger/ledger.js';

type Party = 'restaurant' | 'rider';
type Row = typeof settlements.$inferSelect;

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Midnight in Asia/Colombo (UTC+5:30, no daylight saving) for a local date. */
const colomboMidnight = (date: string) => new Date(`${date}T00:00:00+05:30`);

/**
 * Restaurant statements and rider payouts (ADM-13, ADM-14). A statement collects delivered orders
 * in the period that no earlier statement covered; draft → reviewed → paid. Paying posts to the
 * ledger and freezes the statement with a checksum.
 */
export class SettlementsService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async names(tx: Tx, rows: Row[]) {
    const rIds = rows.filter((r) => r.party === 'restaurant').map((r) => r.partyId);
    const aIds = rows.filter((r) => r.party === 'rider').map((r) => r.partyId);
    const [rs, as] = await Promise.all([
      rIds.length
        ? tx
            .select({ id: restaurants.id, name: restaurants.name })
            .from(restaurants)
            .where(inArray(restaurants.id, rIds))
        : [],
      aIds.length
        ? tx
            .select({ id: accounts.id, name: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, aIds))
        : [],
    ]);
    return new Map([...rs, ...as].map((x) => [x.id, x.name]));
  }

  private async summaries(tx: Tx, rows: Row[]): Promise<SettlementSummary[]> {
    if (!rows.length) return [];
    const [names, counts] = await Promise.all([
      this.names(tx, rows),
      tx
        .select({ id: settlementLines.settlementId, n: sql<number>`count(*)::int` })
        .from(settlementLines)
        .where(
          inArray(
            settlementLines.settlementId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(settlementLines.settlementId),
    ]);
    return rows.map((r) => ({
      id: r.id,
      party: r.party,
      partyId: r.partyId,
      partyName: names.get(r.partyId) ?? 'Unknown',
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      totalCents: r.totalCents,
      status: r.status,
      lineCount: counts.find((c) => c.id === r.id)?.n ?? 0,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
    }));
  }

  list(party: Party): Promise<SettlementSummary[]> {
    return withScope(this.db, PLATFORM, async (tx) =>
      this.summaries(
        tx,
        await tx
          .select()
          .from(settlements)
          .where(eq(settlements.party, party))
          .orderBy(desc(settlements.periodStart), asc(settlements.status))
          .limit(100),
      ),
    );
  }

  get(id: string): Promise<SettlementDetail> {
    return withScope(this.db, PLATFORM, (tx) => this.detail(tx, id));
  }

  private async detail(tx: Tx, id: string): Promise<SettlementDetail> {
    const [row] = await tx.select().from(settlements).where(eq(settlements.id, id));
    if (!row) throw new ApiError('not_found');
    const [[summary], lines] = await Promise.all([
      this.summaries(tx, [row]),
      tx
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, id))
        .orderBy(asc(settlementLines.description)),
    ]);
    let bankDetails: BankDetails | null = null;
    if (row.party === 'restaurant') {
      const [r] = await tx
        .select({ bank: restaurants.bankDetailsCiphertext })
        .from(restaurants)
        .where(eq(restaurants.id, row.partyId));
      if (r?.bank) bankDetails = JSON.parse(decrypt(this.encryptionKey, r.bank)) as BankDetails;
    }
    return {
      ...summary!,
      lines: lines.map((l) => ({
        orderId: l.orderId,
        description: l.description,
        amountCents: l.amountCents,
      })),
      bankDetails,
      checksum: row.checksum,
    };
  }

  /** Delivered orders in the period not on any earlier statement for this kind of party. */
  private async unsettled(tx: Tx, party: Party, start: Date, end: Date) {
    const covered = tx
      .select({ one: sql`1` })
      .from(settlementLines)
      .innerJoin(settlements, eq(settlements.id, settlementLines.settlementId))
      .where(and(eq(settlementLines.orderId, orders.id), eq(settlements.party, party)));
    const base = and(
      eq(orders.status, 'delivered'),
      sql`${orders.closedAt} >= ${start.toISOString()} and ${orders.closedAt} < ${end.toISOString()}`,
      notExists(covered),
    );
    if (party === 'restaurant') {
      return (
        await tx
          .select({
            orderId: orders.id,
            reference: orders.reference,
            partyId: orders.tenantId,
            amountCents: sql<number>`(${orders.itemsCents} + ${orders.restaurantFeeCents})::int`,
          })
          .from(orders)
          .where(base)
      ).map((o) => ({ ...o, description: `Order #${o.reference}` }));
    }
    return (
      await tx
        .select({
          orderId: orders.id,
          reference: orders.reference,
          partyId: offers.riderId,
          amountCents: offers.payoutCents,
        })
        .from(orders)
        .innerJoin(
          offers,
          and(
            eq(offers.orderId, orders.id),
            eq(offers.riderId, orders.riderId),
            eq(offers.outcome, 'accepted'),
          ),
        )
        .where(base)
    ).map((o) => ({ ...o, description: `Delivery #${o.reference}` }));
  }

  /**
   * Builds draft statements for the period, one per restaurant or rider with something due.
   * Running it again replaces the drafts (reviewed and paid ones stay as they are).
   */
  generate(auth: AuthContext, input: GenerateSettlementsInput): Promise<SettlementSummary[]> {
    const periodEnd = input.periodEnd ?? addDays(input.periodStart, 6);
    if (periodEnd < input.periodStart) throw new ApiError('invalid_input', { field: 'periodEnd' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(
      this.clock(),
    );
    if (periodEnd >= today)
      throw new ApiError('invalid_input', { field: 'periodEnd', reason: 'not_over' });
    return withScope(this.db, PLATFORM, async (tx) => {
      // Serialise generation per party so two owners can't build overlapping drafts.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`settlements:${input.party}`}))`,
      );
      const drafts = await tx
        .select({ id: settlements.id })
        .from(settlements)
        .where(
          and(
            eq(settlements.party, input.party),
            eq(settlements.periodStart, input.periodStart),
            eq(settlements.status, 'draft'),
          ),
        );
      if (drafts.length) {
        const ids = drafts.map((d) => d.id);
        await tx.delete(settlementLines).where(inArray(settlementLines.settlementId, ids));
        await tx.delete(settlements).where(inArray(settlements.id, ids));
      }
      const lines = await this.unsettled(
        tx,
        input.party,
        colomboMidnight(input.periodStart),
        colomboMidnight(addDays(periodEnd, 1)),
      );
      const byParty = new Map<string, typeof lines>();
      for (const l of lines) {
        if (!l.partyId) continue;
        byParty.set(l.partyId, [...(byParty.get(l.partyId) ?? []), l]);
      }
      const created: Row[] = [];
      for (const [partyId, ls] of byParty) {
        const [existing] = await tx
          .select({ id: settlements.id })
          .from(settlements)
          .where(
            and(
              eq(settlements.party, input.party),
              eq(settlements.partyId, partyId),
              eq(settlements.periodStart, input.periodStart),
            ),
          );
        // Already reviewed or paid for this start date: late deliveries wait for the next period.
        if (existing) continue;
        const [s] = await tx
          .insert(settlements)
          .values({
            party: input.party,
            partyId,
            tenantId: input.party === 'restaurant' ? partyId : null,
            periodStart: input.periodStart,
            periodEnd,
            totalCents: ls.reduce((n, l) => n + l.amountCents, 0),
          })
          .returning();
        await tx.insert(settlementLines).values(
          ls.map((l) => ({
            settlementId: s!.id,
            tenantId: input.party === 'restaurant' ? partyId : null,
            orderId: l.orderId,
            description: l.description,
            amountCents: l.amountCents,
          })),
        );
        created.push(s!);
      }
      await this.audit(tx, auth, 'settlements.generated', input.party, {
        periodStart: input.periodStart,
        periodEnd,
        count: created.length,
      });
      return this.summaries(tx, created);
    });
  }

  private async audit(tx: Tx, auth: AuthContext, action: string, targetId: string, after: object) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'settlement',
      targetId,
      after: after as Record<string, unknown>,
      deviceId: auth.deviceId,
    });
  }

  private async lock(tx: Tx, id: string): Promise<Row> {
    const [row] = await tx.select().from(settlements).where(eq(settlements.id, id)).for('update');
    if (!row) throw new ApiError('not_found');
    return row;
  }

  /** Someone has checked the statement against the orders. */
  review(auth: AuthContext, id: string): Promise<SettlementDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status !== 'draft') throw new ApiError('invalid_transition', { status: row.status });
      await tx.update(settlements).set({ status: 'reviewed' }).where(eq(settlements.id, id));
      await this.audit(tx, auth, 'settlement.reviewed', id, { totalCents: row.totalCents });
      return this.detail(tx, id);
    });
  }

  /** The money has gone out: freeze with a checksum and post to the ledger. */
  markPaid(auth: AuthContext, id: string, reference?: string): Promise<SettlementDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status !== 'reviewed')
        throw new ApiError('invalid_transition', { status: row.status });
      const lines = await tx
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, id))
        .orderBy(asc(settlementLines.id));
      const checksum = createHash('sha256')
        .update(
          JSON.stringify({
            id,
            party: row.party,
            partyId: row.partyId,
            period: [row.periodStart, row.periodEnd],
            total: row.totalCents,
            lines: lines.map((l) => [l.orderId, l.description, l.amountCents]),
          }),
        )
        .digest('hex');
      await tx
        .update(settlements)
        .set({ status: 'paid', checksum, paidAt: this.clock() })
        .where(eq(settlements.id, id));
      await postSettlementPaid(tx, {
        party: row.party,
        partyId: row.partyId,
        amountCents: row.totalCents,
        actorId: auth.accountId,
        settlementId: id,
      });
      await this.audit(tx, auth, 'settlement.paid', id, {
        totalCents: row.totalCents,
        reference,
        checksum,
      });
      return this.detail(tx, id);
    });
  }

  /** CSV for the accountant or the bank upload. */
  async csv(id: string): Promise<string> {
    const d = await this.get(id);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      ['party', 'name', 'period_start', 'period_end', 'line', 'amount_lkr'],
      ...d.lines.map((l) => [
        d.party,
        d.partyName,
        d.periodStart,
        d.periodEnd,
        l.description,
        (l.amountCents / 100).toFixed(2),
      ]),
      [d.party, d.partyName, d.periodStart, d.periodEnd, 'TOTAL', (d.totalCents / 100).toFixed(2)],
    ];
    return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  }
}
