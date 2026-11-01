import type { RateOrderInput, ReviewResponse } from '@oyo/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { accounts, orders, reviews } from '../db/schema.js';
import { canRate, rateUntil } from './ratings.js';

/** Ratings after delivery (CUS-16) and reviews on restaurant pages (CUS-20). */
export class ReviewsService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Creates or edits the customer's ratings for a delivered order, inside the 24-hour window. */
  rate(auth: AuthContext, orderId: string, input: RateOrderInput): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order || order.customerId !== auth.accountId) throw new ApiError('not_found');
      if (!canRate(order, this.clock())) throw new ApiError('rating_closed');
      if (input.rider && !order.riderId) throw new ApiError('not_found', { what: 'rider' });

      const editableUntil = rateUntil(order)!;
      const upsert = (values: typeof reviews.$inferInsert) =>
        tx
          .insert(reviews)
          .values(values)
          .onConflictDoUpdate({
            target: [reviews.orderId, reviews.subject],
            set: { rating: values.rating, tags: values.tags, body: values.body ?? null },
          });
      const base = { tenantId: order.tenantId, orderId, customerId: auth.accountId, editableUntil };
      await upsert({
        ...base,
        subject: 'restaurant',
        rating: input.restaurant.rating,
        tags: input.restaurant.tags,
        body: input.restaurant.body || null,
      });
      if (input.rider) {
        await upsert({
          ...base,
          subject: 'rider',
          riderId: order.riderId,
          rating: input.rider.rating,
          tags: input.rider.tags,
        });
      }
    });
  }

  /** Latest visible reviews for a restaurant. Every review comes from a delivered order by construction. */
  forRestaurant(restaurantId: string): Promise<ReviewResponse[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const rows = await tx
        .select({ review: reviews, name: accounts.displayName })
        .from(reviews)
        .innerJoin(accounts, eq(accounts.id, reviews.customerId))
        .where(
          and(
            eq(reviews.tenantId, restaurantId),
            eq(reviews.subject, 'restaurant'),
            eq(reviews.hidden, false),
          ),
        )
        .orderBy(desc(reviews.createdAt))
        .limit(20);
      return rows.map(({ review, name }) => ({
        rating: review.rating,
        tags: review.tags,
        body: review.body,
        author: name.trim().split(/\s+/)[0] || 'Customer',
        createdAt: review.createdAt.toISOString(),
        reply: review.reply,
      }));
    });
  }
}
