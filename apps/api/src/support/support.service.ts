import { createHash } from 'node:crypto';
import {
  can,
  CASE_LABELS,
  formatLkr,
  needsOwner,
  refundable,
  REFUND_REASON_LABELS,
  URGENT_CASES,
  type CancelRequestInput,
  type CaseType,
  type MyCase,
  type ProblemReportInput,
  type RefundInput,
  type RefundRecord,
  type RiderIssueInput,
  type SupportCase,
} from '@oyo/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  bankSlips,
  ledgerTransactions,
  orders,
  payments,
  refunds,
  restaurants,
  supportCases,
} from '../db/schema.js';
import { postPrepayment, postRefundIssued, postRefundPaid } from '../ledger/ledger.js';
import { notify, officeAccounts } from '../notifications/direct.js';
import { loadSettings } from '../settings/settings.js';
import type { SmsSender } from '../sms/sms.js';
import type { FileStorage } from '../storage/storage.js';
import { emergencyContact } from './rider-profile.js';

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'heif']);

type OrderRow = typeof orders.$inferSelect;

/** What the customer actually paid: cash collected, or a bank transfer that arrived. */
export async function orderPaidCents(tx: Tx, o: OrderRow): Promise<number> {
  if (o.paymentMethod === 'cod')
    return o.status === 'delivered' ? (o.cashCollectedCents ?? o.totalCents) : 0;
  const [slip] = await tx
    .select({ status: bankSlips.status })
    .from(bankSlips)
    .where(and(eq(bankSlips.orderId, o.id), inArray(bankSlips.status, ['pending', 'approved'])));
  if (!slip) return 0;
  // The amount transferred: the order total can drop later (an unavailable item, RES-05).
  const [payment] = await tx
    .select({ amountCents: payments.amountCents })
    .from(payments)
    .where(eq(payments.orderId, o.id));
  return payment?.amountCents ?? o.totalCents;
}

/** Paid, less refunds already issued. */
export async function orderRefundableCents(tx: Tx, o: OrderRow): Promise<number> {
  const [{ sum } = { sum: '0' }] = await tx
    .select({ sum: sql<string>`coalesce(sum(${refunds.amountCents}), 0)` })
    .from(refunds)
    .where(eq(refunds.orderId, o.id));
  return refundable({ paidCents: await orderPaidCents(tx, o), refundedCents: Number(sum) });
}

/**
 * Support cases and refunds (CUS-14, CUS-19, RID-13/14, ADM-16). Refunds are owed when issued and
 * paid when the office transfers them; never from a rider's cash (PRD section 9).
 */
export class SupportService {
  constructor(
    private readonly db: Database,
    private readonly storage: FileStorage,
    private readonly encryptionKey: Buffer,
    private readonly sms?: SmsSender,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async customerOrder(tx: Tx, auth: AuthContext, orderId: string): Promise<OrderRow> {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!o || o.customerId !== auth.accountId) throw new ApiError('not_found');
    return o;
  }

  private async openCase(tx: Tx, orderId: string, type: string) {
    const [c] = await tx
      .select({ id: supportCases.id })
      .from(supportCases)
      .where(
        and(
          eq(supportCases.orderId, orderId),
          eq(supportCases.type, type),
          ne(supportCases.status, 'resolved'),
        ),
      );
    return c;
  }

  /** C14: after the restaurant accepts and before pickup, cancelling goes through the office. */
  requestCancel(auth: AuthContext, orderId: string, input: CancelRequestInput): Promise<MyCase[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const o = await this.customerOrder(tx, auth, orderId);
      if (o.status !== 'active') throw new ApiError('invalid_transition', { status: o.status });
      if (await this.openCase(tx, orderId, 'cancel_request')) throw new ApiError('case_open');
      await tx.insert(supportCases).values({
        orderId,
        tenantId: o.tenantId,
        reporterId: auth.accountId,
        type: 'cancel_request',
        description: input.reason,
      });
      await notify(tx, await officeAccounts(tx), {
        kind: 'case_opened',
        title: `Cancel request on #${o.reference}`,
        body: input.reason,
        data: { orderId },
        critical: true,
      });
      return this.cases(tx, auth, orderId);
    });
  }

  /** C19: a problem with photos, on a delivered order or one on its way. */
  async reportProblem(
    auth: AuthContext,
    orderId: string,
    input: ProblemReportInput,
    files: UploadedPhoto[],
  ): Promise<MyCase[]> {
    if (files.length > 3) throw new ApiError('photo_invalid', { reason: 'too_many' });
    const cleaned: Buffer[] = [];
    for (const f of files) {
      if (f.size > PHOTO_MAX_BYTES) throw new ApiError('photo_invalid', { reason: 'too_large' });
      const meta = await sharp(f.buffer)
        .metadata()
        .catch(() => null);
      if (!meta?.format || !ACCEPTED.has(meta.format))
        throw new ApiError('photo_invalid', { reason: 'format' });
      // Re-encoded: drops location and any hidden payload (SEC-25).
      cleaned.push(
        await sharp(f.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer(),
      );
    }
    return withScope(this.db, PLATFORM, async (tx) => {
      const o = await this.customerOrder(tx, auth, orderId);
      if (!['active', 'picked_up', 'delivered'].includes(o.status))
        throw new ApiError('invalid_transition', { status: o.status });
      if (
        o.status === 'delivered' &&
        o.closedAt &&
        this.clock().getTime() - o.closedAt.getTime() > 48 * 3_600_000
      )
        throw new ApiError('invalid_transition', { reason: 'too_late' });
      const keys: string[] = [];
      for (const buf of cleaned) {
        const key = `cases/${orderId}/${createHash('sha256').update(buf).digest('hex').slice(0, 24)}.jpg`;
        await this.storage.put(key, buf, 'image/jpeg');
        keys.push(key);
      }
      await tx.insert(supportCases).values({
        orderId,
        tenantId: o.tenantId,
        reporterId: auth.accountId,
        type: input.type,
        description: input.description,
        evidenceKeys: keys,
      });
      await notify(tx, await officeAccounts(tx), {
        kind: 'case_opened',
        title: `${CASE_LABELS[input.type]} on #${o.reference}`,
        body: input.description.slice(0, 140),
        data: { orderId },
      });
      return this.cases(tx, auth, orderId);
    });
  }

  myCases(auth: AuthContext, orderId: string): Promise<MyCase[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.customerOrder(tx, auth, orderId);
      return this.cases(tx, auth, orderId);
    });
  }

  private async cases(tx: Tx, auth: AuthContext, orderId: string): Promise<MyCase[]> {
    const rows = await tx
      .select()
      .from(supportCases)
      .where(and(eq(supportCases.orderId, orderId), eq(supportCases.reporterId, auth.accountId)))
      .orderBy(desc(supportCases.createdAt));
    const rs = await tx.select().from(refunds).where(eq(refunds.orderId, orderId));
    return rows.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
      refunds: rs
        .filter((r) => r.caseId === c.id)
        .map((r) => ({ amountCents: r.amountCents, status: r.status as 'owed' | 'paid' })),
    }));
  }

  /** R12/RID-14: a rider reports a problem on a job, or presses emergency. */
  riderIssue(
    auth: AuthContext,
    orderId: string | null,
    input: RiderIssueInput,
  ): Promise<{ id: string }> {
    return withScope(this.db, PLATFORM, async (tx) => {
      let o: OrderRow | undefined;
      if (orderId) {
        [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
        if (!o || o.riderId !== auth.accountId) throw new ApiError('not_found');
      }
      const [c] = await tx
        .insert(supportCases)
        .values({
          orderId: o?.id ?? null,
          tenantId: o?.tenantId ?? null,
          reporterId: auth.accountId,
          type: input.type,
          description: input.description ?? null,
          location:
            input.lat !== undefined && input.lng !== undefined
              ? { x: input.lng, y: input.lat }
              : null,
        })
        .returning({ id: supportCases.id });
      const [me] = await tx
        .select({ name: accounts.displayName })
        .from(accounts)
        .where(eq(accounts.id, auth.accountId));
      const urgent = URGENT_CASES.includes(input.type);
      // RID-14: the rider's emergency contact hears too, with where they were.
      if (urgent && this.sms) {
        const contact = await emergencyContact(tx, auth.accountId, this.encryptionKey);
        if (contact) {
          const first = (me?.name ?? 'Your rider').trim().split(/\s+/)[0];
          const where =
            input.lat !== undefined && input.lng !== undefined
              ? ` Last location: https://maps.google.com/?q=${input.lat.toFixed(5)},${input.lng.toFixed(5)}`
              : '';
          await this.sms
            .send(
              contact.phone,
              `Oyo Eats: ${first} pressed the emergency button (${CASE_LABELS[input.type].toLowerCase()}).${where} Our office is calling them now.`,
            )
            .catch(() => undefined);
        }
      }
      await notify(tx, await officeAccounts(tx), {
        kind: urgent ? 'rider_emergency' : 'case_opened',
        title: `${urgent ? '⚠ ' : ''}${CASE_LABELS[input.type]}: ${me?.name ?? 'Rider'}`,
        body:
          [o ? `#${o.reference}` : null, input.description].filter(Boolean).join(' · ') ||
          'Call the rider now.',
        data: { orderId: o?.id, caseId: c!.id },
        critical: true,
      });
      return { id: c!.id };
    });
  }

  // Office (A22)

  list(status: 'open' | 'resolved'): Promise<SupportCase[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const rows = await tx
        .select()
        .from(supportCases)
        .where(
          status === 'open'
            ? ne(supportCases.status, 'resolved')
            : eq(supportCases.status, 'resolved'),
        )
        .orderBy(status === 'open' ? asc(supportCases.createdAt) : desc(supportCases.resolvedAt))
        .limit(100);
      return Promise.all(rows.map((r) => this.describe(tx, r, false)));
    });
  }

  get(id: string): Promise<SupportCase> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [c] = await tx.select().from(supportCases).where(eq(supportCases.id, id));
      if (!c) throw new ApiError('not_found');
      return this.describe(tx, c, true);
    });
  }

  private paid(tx: Tx, o: OrderRow): Promise<number> {
    return orderPaidCents(tx, o);
  }

  private async describe(
    tx: Tx,
    c: typeof supportCases.$inferSelect,
    full: boolean,
  ): Promise<SupportCase> {
    const [[reporter], [row]] = await Promise.all([
      tx.select().from(accounts).where(eq(accounts.id, c.reporterId)),
      c.orderId
        ? tx
            .select({ order: orders, restaurantName: restaurants.name })
            .from(orders)
            .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
            .where(eq(orders.id, c.orderId))
        : Promise.resolve([] as { order: OrderRow; restaurantName: string }[]),
    ]);
    const rs = c.orderId
      ? await tx
          .select()
          .from(refunds)
          .where(eq(refunds.orderId, c.orderId))
          .orderBy(asc(refunds.createdAt))
      : [];
    const names = rs.length
      ? await tx
          .select({ id: accounts.id, name: accounts.displayName })
          .from(accounts)
          .where(
            inArray(
              accounts.id,
              rs.map((r) => r.issuedBy),
            ),
          )
      : [];
    const paid = row ? await this.paid(tx, row.order) : 0;
    const refunded = rs.reduce((n, r) => n + r.amountCents, 0);
    return {
      id: c.id,
      type: c.type,
      status: c.status,
      description: c.description,
      reporter: {
        name: reporter?.displayName ?? 'Unknown',
        role: reporter?.role ?? 'unknown',
        phone:
          full && reporter?.phoneCiphertext
            ? decrypt(this.encryptionKey, reporter.phoneCiphertext)
            : null,
      },
      order: row
        ? {
            id: row.order.id,
            reference: row.order.reference,
            restaurantName: row.restaurantName,
            status: row.order.status,
            paymentMethod: row.order.paymentMethod,
            totalCents: row.order.totalCents,
            paidCents: paid,
            refundableCents: refundable({ paidCents: paid, refundedCents: refunded }),
            riderId: row.order.riderId,
          }
        : null,
      photos: full
        ? await Promise.all(c.evidenceKeys.map((k) => this.storage.signedUrl(k, 600)))
        : [],
      location: c.location ? { lat: c.location.y, lng: c.location.x } : null,
      refunds: rs.map((r): RefundRecord => ({
        id: r.id,
        amountCents: r.amountCents,
        reasonCode: r.reasonCode,
        attribution: r.attribution as RefundRecord['attribution'],
        note: r.note,
        status: r.status as RefundRecord['status'],
        issuedBy: names.find((n) => n.id === r.issuedBy)?.name ?? 'Office',
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt?.toISOString() ?? null,
      })),
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
    };
  }

  private async audit(tx: Tx, auth: AuthContext, action: string, targetId: string, after: object) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'support',
      targetId,
      after: after as Record<string, unknown>,
      deviceId: auth.deviceId,
    });
  }

  /**
   * Issue a refund (ADM-16). Capped for dispatchers; never more than was paid less earlier refunds.
   * Refunding a bank transfer whose slip was still unchecked confirms the money arrived.
   */
  refund(
    auth: AuthContext,
    target: { caseId?: string; orderId?: string },
    input: RefundInput,
  ): Promise<SupportCase> {
    return withScope(this.db, PLATFORM, async (tx) => {
      let caseRow: typeof supportCases.$inferSelect | undefined;
      if (target.caseId) {
        [caseRow] = await tx
          .select()
          .from(supportCases)
          .where(eq(supportCases.id, target.caseId))
          .for('update');
        if (!caseRow?.orderId) throw new ApiError('not_found');
      }
      const orderId = caseRow?.orderId ?? target.orderId!;
      // One refund at a time per order, so two dispatchers can't both refund the same money.
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!o) throw new ApiError('not_found');
      const [{ sum } = { sum: '0' }] = await tx
        .select({ sum: sql<string>`coalesce(sum(${refunds.amountCents}), 0)` })
        .from(refunds)
        .where(eq(refunds.orderId, orderId));
      const left = refundable({ paidCents: await this.paid(tx, o), refundedCents: Number(sum) });
      if (input.amountCents > left)
        throw new ApiError('refund_too_large', { refundableCents: left });
      if (!can(auth.role, 'refunds.issue_any')) {
        const { dispatcherRefundCapCents } = await loadSettings(tx);
        if (needsOwner(input.amountCents, dispatcherRefundCapCents))
          throw new ApiError('refund_over_cap', { capCents: dispatcherRefundCapCents ?? 0 });
      }
      if (input.attribution === 'rider' && !o.riderId)
        throw new ApiError('invalid_input', { field: 'attribution' });

      // A transfer still waiting for its slip check: refunding it means the office saw the money.
      if (o.paymentMethod === 'bank_transfer') {
        const [posted] = await tx
          .select({ id: ledgerTransactions.id })
          .from(ledgerTransactions)
          .where(
            and(
              eq(ledgerTransactions.orderId, o.id),
              eq(ledgerTransactions.kind, 'prepayment_received'),
            ),
          );
        if (!posted) {
          await tx
            .update(bankSlips)
            .set({ status: 'approved', reviewedBy: auth.accountId, reviewedAt: this.clock() })
            .where(and(eq(bankSlips.orderId, o.id), eq(bankSlips.status, 'pending')));
          await tx
            .update(payments)
            .set({ status: 'confirmed', confirmedAt: this.clock() })
            .where(and(eq(payments.orderId, o.id), eq(payments.status, 'pending')));
          await postPrepayment(tx, {
            orderId: o.id,
            customerId: o.customerId,
            amountCents: o.totalCents,
            actorId: auth.accountId,
          });
        }
      }

      if (!caseRow) {
        [caseRow] = await tx
          .insert(supportCases)
          .values({
            orderId: o.id,
            tenantId: o.tenantId,
            reporterId: auth.accountId,
            type: 'office',
            description: input.note ?? REFUND_REASON_LABELS[input.reasonCode],
          })
          .returning();
      }
      const [r] = await tx
        .insert(refunds)
        .values({
          orderId: o.id,
          tenantId: o.tenantId,
          caseId: caseRow!.id,
          customerId: o.customerId,
          riderId: o.riderId,
          amountCents: input.amountCents,
          reasonCode: input.reasonCode,
          attribution: input.attribution,
          note: input.note ?? null,
          issuedBy: auth.accountId,
        })
        .returning();
      // Delivered: the customer's money was used up, so the refund is a new debt to them, borne by
      // the attributed party. Not delivered and prepaid: the prepayment is still owed already.
      if (o.status === 'delivered') {
        await postRefundIssued(tx, {
          id: r!.id,
          orderId: o.id,
          customerId: o.customerId,
          tenantId: o.tenantId,
          riderId: o.riderId,
          amountCents: input.amountCents,
          attribution: input.attribution,
          actorId: auth.accountId,
        });
      }
      if (caseRow!.status === 'open')
        await tx
          .update(supportCases)
          .set({ status: 'in_progress', assigneeId: auth.accountId })
          .where(eq(supportCases.id, caseRow!.id));
      await notify(tx, [o.customerId], {
        kind: 'refund_issued',
        title: `Refund of ${formatLkr(input.amountCents)} for #${o.reference}`,
        body: 'The Oyo Eats office will transfer it to you and call if they need your bank details.',
        data: { orderId: o.id },
      });
      await this.audit(tx, auth, 'refund.issued', r!.id, {
        orderId: o.id,
        amountCents: input.amountCents,
        reasonCode: input.reasonCode,
        attribution: input.attribution,
      });
      return this.describe(
        tx,
        (await tx.select().from(supportCases).where(eq(supportCases.id, caseRow!.id)))[0]!,
        true,
      );
    });
  }

  /** The office has transferred the refund (owner). */
  markRefundPaid(auth: AuthContext, refundId: string, reference?: string): Promise<SupportCase> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
      if (!r) throw new ApiError('not_found');
      if (r.status !== 'owed') throw new ApiError('invalid_transition', { status: r.status });
      await tx
        .update(refunds)
        .set({
          status: 'paid',
          paidBy: auth.accountId,
          paidAt: this.clock(),
          paidReference: reference ?? null,
        })
        .where(eq(refunds.id, refundId));
      await postRefundPaid(tx, {
        id: r.id,
        orderId: r.orderId,
        customerId: r.customerId,
        amountCents: r.amountCents,
        actorId: auth.accountId,
      });
      await this.audit(tx, auth, 'refund.paid', r.id, { amountCents: r.amountCents, reference });
      const [c] = r.caseId
        ? await tx.select().from(supportCases).where(eq(supportCases.id, r.caseId))
        : [];
      return this.describe(tx, c!, true);
    });
  }

  resolve(auth: AuthContext, id: string, resolution: string): Promise<SupportCase> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [c] = await tx.select().from(supportCases).where(eq(supportCases.id, id)).for('update');
      if (!c) throw new ApiError('not_found');
      if (c.status === 'resolved') throw new ApiError('invalid_transition', { status: c.status });
      const [updated] = await tx
        .update(supportCases)
        .set({
          status: 'resolved',
          resolution,
          resolvedAt: this.clock(),
          assigneeId: c.assigneeId ?? auth.accountId,
        })
        .where(eq(supportCases.id, id))
        .returning();
      if (c.reporterId) {
        const [reporter] = await tx
          .select({ role: accounts.role })
          .from(accounts)
          .where(eq(accounts.id, c.reporterId));
        if (reporter?.role === 'customer')
          await notify(tx, [c.reporterId], {
            kind: 'case_resolved',
            title: `${CASE_LABELS[c.type as CaseType] ?? 'Your request'}: answered`,
            body: resolution,
            data: { orderId: c.orderId },
          });
      }
      await this.audit(tx, auth, 'case.resolved', id, { resolution });
      return this.describe(tx, updated!, true);
    });
  }
}
