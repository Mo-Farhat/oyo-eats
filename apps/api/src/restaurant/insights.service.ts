import type { RestaurantHistory, RestaurantReviews } from '@oyo/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { scopeFor } from '../auth/scope.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { accounts, auditLog, orderItems, orders, reviews } from '../db/schema.js';

const DAY_MS = 86_400_000;

/** T12: reviews with replies (RES-12) and order history with daily sales (RES-13). */
export class RestaurantInsightsService {
  constructor(private readonly db: Database) {}

  async reviews(auth: AuthContext): Promise<RestaurantReviews> {
    const rows = await withScope(this.db, scopeFor(auth), (tx) =>
      tx
        .select({ review: reviews, reference: orders.reference })
        .from(reviews)
        .innerJoin(orders, eq(orders.id, reviews.orderId))
        .where(and(eq(reviews.tenantId, auth.tenantId!), eq(reviews.subject, 'restaurant')))
        .orderBy(desc(reviews.createdAt))
        .limit(100),
    );
    // First names only, read in platform scope for these reviews' authors (section 6).
    const authors = rows.length
      ? await withScope(this.db, PLATFORM, (tx) =>
          tx
            .select({ id: accounts.id, name: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, [...new Set(rows.map((r) => r.review.customerId))])),
        )
      : [];
    const visible = rows.filter((r) => !r.review.hidden);
    return {
      rating: visible.length
        ? Math.round((visible.reduce((n, r) => n + r.review.rating, 0) / visible.length) * 10) / 10
        : null,
      count: visible.length,
      reviews: rows.map(({ review: r, reference }) => ({
        id: r.id,
        orderReference: reference,
        rating: r.rating,
        tags: r.tags,
        body: r.body,
        author:
          (authors.find((a) => a.id === r.customerId)?.name ?? '').trim().split(/\s+/)[0] ||
          'Customer',
        reply: r.reply,
        hidden: r.hidden,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** One public reply per review; it can be edited. */
  reply(auth: AuthContext, reviewId: string, reply: string): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const [row] = await tx
        .update(reviews)
        .set({ reply })
        .where(
          and(
            eq(reviews.id, reviewId),
            eq(reviews.tenantId, auth.tenantId!),
            eq(reviews.subject, 'restaurant'),
          ),
        )
        .returning({ id: reviews.id });
      if (!row) throw new ApiError('not_found');
    });
  }

  history(auth: AuthContext, from: string, to: string): Promise<RestaurantHistory> {
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
    if (end <= start || end.getTime() - start.getTime() > 31 * DAY_MS)
      throw new ApiError('invalid_input', { field: 'to', reason: 'range' });
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const rows = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, auth.tenantId!),
            sql`${orders.placedAt} >= ${start.toISOString()} and ${orders.placedAt} < ${end.toISOString()}`,
            // Bank-transfer orders the kitchen never saw aren't the restaurant's history.
            sql`${orders.status} <> 'awaiting_payment'`,
          ),
        )
        .orderBy(desc(orders.placedAt));
      const counts = rows.length
        ? await tx
            .select({
              orderId: orderItems.orderId,
              n: sql<number>`sum(${orderItems.quantity})::int`,
            })
            .from(orderItems)
            .where(
              inArray(
                orderItems.orderId,
                rows.map((r) => r.id),
              ),
            )
            .groupBy(orderItems.orderId)
        : [];
      const colomboDate = (d: Date) =>
        new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      const days: RestaurantHistory['days'] = [];
      for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
        const date = colomboDate(new Date(t));
        const mine = rows.filter((r) => colomboDate(r.placedAt) === date);
        const delivered = mine.filter((r) => r.status === 'delivered');
        days.push({
          date,
          delivered: delivered.length,
          salesCents: delivered.reduce((n, r) => n + r.itemsCents + r.restaurantFeeCents, 0),
          cancelled: mine.filter((r) => ['cancelled', 'rejected', 'failed'].includes(r.status))
            .length,
        });
      }
      return {
        from,
        to,
        days: days.reverse(),
        totals: {
          delivered: days.reduce((n, d) => n + d.delivered, 0),
          salesCents: days.reduce((n, d) => n + d.salesCents, 0),
          cancelled: days.reduce((n, d) => n + d.cancelled, 0),
        },
        orders: rows.map((r) => ({
          id: r.id,
          reference: r.reference,
          placedAt: r.placedAt.toISOString(),
          status: r.status,
          paymentMethod: r.paymentMethod,
          itemCount: counts.find((c) => c.orderId === r.id)?.n ?? 0,
          salesCents: r.itemsCents + r.restaurantFeeCents,
        })),
      };
    });
  }

  async historyCsv(auth: AuthContext, from: string, to: string): Promise<string> {
    const h = await this.history(auth, from, to);
    const lines = [
      'date_time,reference,status,payment,items,food_lkr',
      ...h.orders.map((o) =>
        [
          new Date(o.placedAt)
            .toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })
            .replace(',', ''),
          o.reference,
          o.status,
          o.paymentMethod,
          o.itemCount,
          (o.salesCents / 100).toFixed(2),
        ].join(','),
      ),
    ];
    return lines.join('\n') + '\n';
  }
}

/** RES-12: the office can hide an abusive review (it stays on record). */
export async function setReviewHidden(
  db: Database,
  auth: AuthContext,
  reviewId: string,
  hidden: boolean,
) {
  await withScope(db, PLATFORM, async (tx) => {
    const [row] = await tx
      .update(reviews)
      .set({ hidden })
      .where(eq(reviews.id, reviewId))
      .returning({ id: reviews.id });
    if (!row) throw new ApiError('not_found');
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action: hidden ? 'review.hidden' : 'review.shown',
      targetType: 'review',
      targetId: reviewId,
      deviceId: auth.deviceId,
    });
  });
}
