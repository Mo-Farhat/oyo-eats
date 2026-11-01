import { RATING_EDIT_HOURS, type OrderRatings } from '@oyo/shared';
import { inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { reviews } from '../db/schema.js';
import type { OrderRow } from '../orders/order-events.js';

/** End of the 24-hour rating window (CUS-16), counted from delivery. */
export function rateUntil(order: OrderRow): Date | null {
  if (order.status !== 'delivered' || !order.closedAt) return null;
  return new Date(order.closedAt.getTime() + RATING_EDIT_HOURS * 3_600_000);
}

export function canRate(order: OrderRow, now: Date): boolean {
  const until = rateUntil(order);
  return until !== null && now < until;
}

/** Ratings the customer gave, per order. */
export async function ratingsFor(tx: Tx, orderIds: string[]): Promise<Map<string, OrderRatings>> {
  const result = new Map<string, OrderRatings>(
    orderIds.map((id) => [id, { restaurant: null, rider: null }]),
  );
  if (orderIds.length === 0) return result;
  for (const r of await tx.select().from(reviews).where(inArray(reviews.orderId, orderIds))) {
    const entry = result.get(r.orderId)!;
    if (r.subject === 'restaurant')
      entry.restaurant = { rating: r.rating, tags: r.tags, body: r.body };
    else entry.rider = { rating: r.rating, tags: r.tags };
  }
  return result;
}
