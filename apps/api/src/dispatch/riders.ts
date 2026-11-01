import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { cashHandovers, orders } from '../db/schema.js';

/** Open jobs per rider: assigned and not yet delivered. */
export async function activeJobs(tx: Tx, riderIds: string[]): Promise<Map<string, number>> {
  if (!riderIds.length) return new Map();
  const rows = await tx
    .select({ riderId: orders.riderId, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inArray(orders.riderId, riderIds), inArray(orders.status, ['active', 'picked_up'])))
    .groupBy(orders.riderId);
  return new Map(rows.map((r) => [r.riderId!, r.n]));
}

/**
 * COD cash a rider holds: cash collected on delivered orders minus cash handed to the office
 * (RID-12). The ledger takes this over with settlements (Milestone 4).
 */
export async function cashHeld(tx: Tx, riderIds: string[]): Promise<Map<string, number>> {
  if (!riderIds.length) return new Map();
  const [collected, handed] = await Promise.all([
    tx
      .select({
        riderId: orders.riderId,
        cents: sql<number>`coalesce(sum(${orders.cashCollectedCents}), 0)::bigint`,
      })
      .from(orders)
      .where(and(inArray(orders.riderId, riderIds), eq(orders.status, 'delivered')))
      .groupBy(orders.riderId),
    tx
      .select({
        riderId: cashHandovers.riderId,
        cents: sql<number>`coalesce(sum(${cashHandovers.amountCents}), 0)::bigint`,
      })
      .from(cashHandovers)
      .where(inArray(cashHandovers.riderId, riderIds))
      .groupBy(cashHandovers.riderId),
  ]);
  return new Map(
    riderIds.map((id) => [
      id,
      Number(collected.find((c) => c.riderId === id)?.cents ?? 0) -
        Number(handed.find((h) => h.riderId === id)?.cents ?? 0),
    ]),
  );
}
