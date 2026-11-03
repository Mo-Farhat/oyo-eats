import {
  normalizeSriLankanMobile,
  type AdminCustomerDetail,
  type AdminCustomerSummary,
} from '@oyo/shared';
import { and, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt, hmac } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  orders,
  refunds,
  restaurants,
  sessions,
  supportCases,
} from '../db/schema.js';

type Account = typeof accounts.$inferSelect;

/** A18 (ADM-15): find a customer, see their orders, flag them, take away COD, block (owner). */
export class CustomersService {
  constructor(
    private readonly db: Database,
    private readonly keys: { hashKey: Buffer; encryptionKey: Buffer },
  ) {}

  private async summaries(tx: Tx, rows: Account[]): Promise<AdminCustomerSummary[]> {
    if (!rows.length) return [];
    const stats = await tx
      .select({
        id: orders.customerId,
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${orders.placedAt})`,
      })
      .from(orders)
      .where(
        inArray(
          orders.customerId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(orders.customerId);
    return rows.map((a) => {
      const s = stats.find((x) => x.id === a.id);
      return {
        id: a.id,
        name: a.displayName,
        phone: a.phoneCiphertext ? decrypt(this.keys.encryptionKey, a.phoneCiphertext) : null,
        orders: s?.n ?? 0,
        lastOrderAt: s?.last ? new Date(s.last).toISOString() : null,
        flagNote: a.flagNote,
        codBlocked: a.codBlocked,
        blocked: a.status !== 'active',
      };
    });
  }

  /** By phone (exact, any local format) or name; without a query, the most recent customers. */
  search(q?: string): Promise<AdminCustomerSummary[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const query = q?.trim() ?? '';
      const phone = /\d{7,}/.test(query.replace(/\D/g, ''))
        ? normalizeSriLankanMobile(query)
        : null;
      const base = eq(accounts.role, 'customer');
      let rows: Account[];
      if (phone) {
        rows = await tx
          .select()
          .from(accounts)
          .where(and(base, eq(accounts.phoneHash, hmac(this.keys.hashKey, `phone:${phone}`))));
      } else if (query) {
        rows = await tx
          .select()
          .from(accounts)
          .where(
            and(
              base,
              ilike(accounts.displayName, `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
            ),
          )
          .limit(50);
      } else {
        rows = await tx
          .select()
          .from(accounts)
          .where(
            and(
              base,
              sql`exists (select 1 from ${orders} o where o.customer_id = ${accounts.id} and o.placed_at > now() - interval '7 days')`,
            ),
          )
          .limit(50);
      }
      const out = await this.summaries(tx, rows);
      return out.sort((a, b) => (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? ''));
    });
  }

  get(id: string): Promise<AdminCustomerDetail> {
    return withScope(this.db, PLATFORM, (tx) => this.detail(tx, id));
  }

  private async customer(tx: Tx, id: string, lock = false): Promise<Account> {
    const q = tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.role, 'customer')));
    const [a] = lock ? await q.for('update') : await q;
    if (!a) throw new ApiError('not_found');
    return a;
  }

  private async detail(tx: Tx, id: string): Promise<AdminCustomerDetail> {
    const a = await this.customer(tx, id);
    const [[summary], counts, [refunded], [cases], recent] = await Promise.all([
      this.summaries(tx, [a]),
      tx
        .select({ status: orders.status, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.customerId, id))
        .groupBy(orders.status),
      tx
        .select({ cents: sql<string>`coalesce(sum(${refunds.amountCents}), 0)` })
        .from(refunds)
        .where(eq(refunds.customerId, id)),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(supportCases)
        .where(and(eq(supportCases.reporterId, id), ne(supportCases.status, 'resolved'))),
      tx
        .select({ order: orders, restaurantName: restaurants.name })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.placedAt))
        .limit(20),
    ]);
    const n = (statuses: string[]) =>
      counts.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c.n, 0);
    return {
      ...summary!,
      joinedAt: a.createdAt.toISOString(),
      delivered: n(['delivered']),
      cancelled: n(['cancelled', 'rejected', 'failed']),
      refundedCents: Number(refunded?.cents ?? 0),
      openCases: cases?.n ?? 0,
      recent: recent.map(({ order: o, restaurantName }) => ({
        id: o.id,
        reference: o.reference,
        restaurantName,
        status: o.status,
        paymentMethod: o.paymentMethod,
        totalCents: o.totalCents,
        placedAt: o.placedAt.toISOString(),
      })),
    };
  }

  private async audit(tx: Tx, auth: AuthContext, action: string, id: string, after: object) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'customer',
      targetId: id,
      after: after as Record<string, unknown>,
      deviceId: auth.deviceId,
    });
  }

  /** An office note shown wherever dispatch sees this customer. Null clears it. */
  flag(auth: AuthContext, id: string, note: string | null): Promise<AdminCustomerDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.customer(tx, id, true);
      await tx.update(accounts).set({ flagNote: note }).where(eq(accounts.id, id));
      await this.audit(tx, auth, note ? 'customer.flagged' : 'customer.unflagged', id, { note });
      return this.detail(tx, id);
    });
  }

  /** COD eligibility: off means bank transfer only from the next quote. */
  setCod(auth: AuthContext, id: string, allowed: boolean): Promise<AdminCustomerDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.customer(tx, id, true);
      await tx.update(accounts).set({ codBlocked: !allowed }).where(eq(accounts.id, id));
      await this.audit(tx, auth, allowed ? 'customer.cod_allowed' : 'customer.cod_blocked', id, {});
      return this.detail(tx, id);
    });
  }

  /** Owner only: a blocked customer is signed out everywhere and can't sign in. Orders already placed carry on. */
  setBlocked(
    auth: AuthContext,
    id: string,
    blocked: boolean,
    reason?: string,
  ): Promise<AdminCustomerDetail> {
    if (blocked && !reason) throw new ApiError('invalid_input', { field: 'reason' });
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.customer(tx, id, true);
      const now = new Date();
      await tx
        .update(accounts)
        .set(
          blocked
            ? { status: 'deactivated', deactivatedAt: now }
            : { status: 'active', deactivatedAt: null },
        )
        .where(eq(accounts.id, id));
      if (blocked) {
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: 'customer_blocked' })
          .where(and(eq(sessions.accountId, id), isNull(sessions.revokedAt)));
      }
      await this.audit(tx, auth, blocked ? 'customer.blocked' : 'customer.unblocked', id, {
        reason,
      });
      return this.detail(tx, id);
    });
  }
}
