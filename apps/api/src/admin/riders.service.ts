import type {
  AdminRiderDetail,
  AdminRiderSummary,
  CashHandoverInput,
  CashHandoverRecord,
} from '@oyo/shared';
import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  cashHandovers,
  offers,
  orders,
  reviews,
  riders,
} from '../db/schema.js';
import { activeJobs, cashHeld } from '../dispatch/riders.js';
import { postCashHandover } from '../ledger/ledger.js';
import { loadSettings } from '../settings/settings.js';

const NO_SIGNAL_MS = 2 * 60_000;
const startOfColomboDay = sql`(date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')`;

/** A08, A09, A11 (ADM-07, ADM-09): riders for dispatch, their cash, and handovers to the office. */
export class AdminRidersService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async summaries(tx: Tx, ids?: string[]): Promise<AdminRiderSummary[]> {
    const rows = await tx
      .select({ rider: riders, account: accounts })
      .from(riders)
      .innerJoin(accounts, eq(accounts.id, riders.accountId))
      .where(ids ? inArray(riders.accountId, ids) : undefined)
      .orderBy(accounts.displayName);
    const riderIds = rows.map((r) => r.rider.accountId);
    if (!riderIds.length) return [];
    const [jobs, cash, settings, delivered, declined] = await Promise.all([
      activeJobs(tx, riderIds),
      cashHeld(tx, riderIds),
      loadSettings(tx),
      tx
        .select({ riderId: orders.riderId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            inArray(orders.riderId, riderIds),
            eq(orders.status, 'delivered'),
            sql`${orders.closedAt} >= ${startOfColomboDay}`,
          ),
        )
        .groupBy(orders.riderId),
      tx
        .select({ riderId: offers.riderId, n: sql<number>`count(*)::int` })
        .from(offers)
        .where(
          and(
            inArray(offers.riderId, riderIds),
            eq(offers.outcome, 'declined'),
            sql`${offers.sentAt} >= ${startOfColomboDay}`,
          ),
        )
        .groupBy(offers.riderId),
    ]);
    const now = this.clock().getTime();
    return rows.map(({ rider, account }) => {
      const n = jobs.get(rider.accountId) ?? 0;
      const status: AdminRiderSummary['status'] =
        account.status !== 'active'
          ? 'suspended'
          : n > 0
            ? 'on_job'
            : !rider.online
              ? 'offline'
              : rider.paused
                ? 'paused'
                : 'idle';
      return {
        id: rider.accountId,
        name: account.displayName,
        username: account.username,
        vehicle: rider.vehicleType,
        plate: rider.plate,
        status,
        activeJobs: n,
        cashHeldCents: cash.get(rider.accountId) ?? 0,
        cashCapCents: settings.riderCaps.cashCapCents,
        lastSeenAt: rider.lastSeenAt?.toISOString() ?? null,
        noSignal:
          rider.online && (!rider.lastSeenAt || now - rider.lastSeenAt.getTime() > NO_SIGNAL_MS),
        deliveredToday: delivered.find((d) => d.riderId === rider.accountId)?.n ?? 0,
        declinedToday: declined.find((d) => d.riderId === rider.accountId)?.n ?? 0,
      };
    });
  }

  list(): Promise<AdminRiderSummary[]> {
    return withScope(this.db, PLATFORM, (tx) => this.summaries(tx));
  }

  get(id: string): Promise<AdminRiderDetail> {
    return withScope(this.db, PLATFORM, (tx) => this.detail(tx, id));
  }

  private async detail(tx: Tx, id: string): Promise<AdminRiderDetail> {
    const [summary] = await this.summaries(tx, [id]);
    if (!summary) throw new ApiError('not_found', { what: 'rider' });
    const [[account], [rider], [rated], [declinedWeek], jobs, handoverRows, low] =
      await Promise.all([
        tx.select().from(accounts).where(eq(accounts.id, id)),
        tx.select().from(riders).where(eq(riders.accountId, id)),
        tx
          .select({
            avg: sql<string | null>`avg(${reviews.rating})`,
            n: sql<number>`count(*)::int`,
          })
          .from(reviews)
          .where(and(eq(reviews.riderId, id), eq(reviews.subject, 'rider'))),
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(offers)
          .where(
            and(
              eq(offers.riderId, id),
              eq(offers.outcome, 'declined'),
              sql`${offers.sentAt} >= now() - interval '7 days'`,
            ),
          ),
        tx
          .select({ orderId: orders.id, reference: orders.reference, status: orders.status })
          .from(orders)
          .where(and(eq(orders.riderId, id), inArray(orders.status, ['active', 'picked_up']))),
        tx
          .select()
          .from(cashHandovers)
          .where(eq(cashHandovers.riderId, id))
          .orderBy(desc(cashHandovers.recordedAt))
          .limit(10),
        tx
          .select()
          .from(reviews)
          .where(
            and(
              eq(reviews.riderId, id),
              eq(reviews.subject, 'rider'),
              lte(reviews.rating, 2),
              sql`${reviews.createdAt} >= now() - interval '30 days'`,
            ),
          )
          .orderBy(desc(reviews.createdAt))
          .limit(5),
      ]);
    const lastHandover = handoverRows[0]?.recordedAt;
    const cashOrders = await tx
      .select({
        orderId: orders.id,
        reference: orders.reference,
        cashCents: orders.cashCollectedCents,
        deliveredAt: orders.closedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.riderId, id),
          eq(orders.status, 'delivered'),
          eq(orders.paymentMethod, 'cod'),
          lastHandover ? gt(orders.closedAt, lastHandover) : undefined,
        ),
      )
      .orderBy(desc(orders.closedAt));
    const names = await this.names(
      tx,
      handoverRows.flatMap((h) => [h.recordedBy, h.countersignedBy]),
    );
    return {
      ...summary,
      phone: account?.phoneCiphertext ? decrypt(this.encryptionKey, account.phoneCiphertext) : null,
      nicOnFile: !!rider?.nicCiphertext,
      rating: rated?.avg ? Math.round(Number(rated.avg) * 10) / 10 : null,
      ratingCount: rated?.n ?? 0,
      declinedThisWeek: declinedWeek?.n ?? 0,
      jobs,
      cashOrders: cashOrders.map((o) => ({
        orderId: o.orderId,
        reference: o.reference,
        cashCents: o.cashCents ?? 0,
        deliveredAt: (o.deliveredAt ?? new Date(0)).toISOString(),
      })),
      handovers: handoverRows.map((h) => this.record(h, names)),
      lowRatings: low.map((r) => ({
        rating: r.rating,
        body: r.body,
        tags: r.tags,
        at: r.createdAt.toISOString(),
      })),
    };
  }

  private async names(tx: Tx, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unique.length) return new Map<string, string>();
    const rows = await tx
      .select({ id: accounts.id, name: accounts.displayName })
      .from(accounts)
      .where(inArray(accounts.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private record(
    h: typeof cashHandovers.$inferSelect,
    names: Map<string, string>,
  ): CashHandoverRecord {
    return {
      id: h.id,
      amountCents: h.amountCents,
      expectedCents: h.expectedCents,
      varianceReason: h.varianceReason,
      recordedBy: names.get(h.recordedBy) ?? 'Office',
      countersignedBy: h.countersignedBy ? (names.get(h.countersignedBy) ?? 'Owner') : null,
      recordedAt: h.recordedAt.toISOString(),
    };
  }

  private async audit(tx: Tx, auth: AuthContext, action: string, targetId: string, after: object) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'rider',
      targetId,
      after: after as Record<string, unknown>,
      deviceId: auth.deviceId,
    });
  }

  /**
   * A11: the rider hands cash to the office. Expected is everything they hold right now; a
   * shortfall stays on their balance (and an overpayment reduces it) until the owner deals with it.
   */
  recordHandover(
    auth: AuthContext,
    id: string,
    input: CashHandoverInput,
  ): Promise<AdminRiderDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      // One handover at a time per rider: the expected amount must not move underneath us.
      const [rider] = await tx.select().from(riders).where(eq(riders.accountId, id)).for('update');
      if (!rider) throw new ApiError('not_found', { what: 'rider' });
      const expected = (await cashHeld(tx, [id])).get(id) ?? 0;
      if (expected <= 0 && input.amountCents === 0)
        throw new ApiError('invalid_input', {
          field: 'amountCents',
          reason: 'nothing_to_hand_over',
        });
      const differs = input.amountCents !== expected;
      if (differs && !input.reason) throw new ApiError('variance_reason_required');
      const [row] = await tx
        .insert(cashHandovers)
        .values({
          riderId: id,
          amountCents: input.amountCents,
          expectedCents: expected,
          varianceReason: differs ? input.reason! : null,
          recordedBy: auth.accountId,
          recordedAt: this.clock(),
        })
        .returning();
      await postCashHandover(tx, {
        riderId: id,
        amountCents: input.amountCents,
        actorId: auth.accountId,
        handoverId: row!.id,
      });
      await this.audit(tx, auth, 'cash.handover_recorded', id, {
        handoverId: row!.id,
        amountCents: input.amountCents,
        expectedCents: expected,
        reason: differs ? input.reason : undefined,
      });
      return this.detail(tx, id);
    });
  }

  /** The owner signs off a handover that didn't match (PRD section 9, cash). */
  countersign(auth: AuthContext, handoverId: string): Promise<AdminRiderDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [h] = await tx
        .select()
        .from(cashHandovers)
        .where(eq(cashHandovers.id, handoverId))
        .for('update');
      if (!h || h.amountCents === h.expectedCents || h.countersignedBy)
        throw new ApiError('not_found');
      await tx
        .update(cashHandovers)
        .set({ countersignedBy: auth.accountId })
        .where(and(eq(cashHandovers.id, handoverId), isNull(cashHandovers.countersignedBy)));
      await this.audit(tx, auth, 'cash.handover_countersigned', h.riderId, { handoverId });
      return this.detail(tx, h.riderId);
    });
  }

  /** Take a rider offline (no signal, end of shift). Not mid-job: reassign first. */
  forceOffline(auth: AuthContext, id: string): Promise<AdminRiderDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [rider] = await tx.select().from(riders).where(eq(riders.accountId, id)).for('update');
      if (!rider) throw new ApiError('not_found', { what: 'rider' });
      if (((await activeJobs(tx, [id])).get(id) ?? 0) > 0) throw new ApiError('rider_busy');
      await tx.update(riders).set({ online: false }).where(eq(riders.accountId, id));
      await this.audit(tx, auth, 'rider.forced_offline', id, {});
      return this.detail(tx, id);
    });
  }
}
