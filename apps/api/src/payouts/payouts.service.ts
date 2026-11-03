import type { RestaurantPayouts, RiderEarnings, SettlementDetail } from '@oyo/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { SettlementsService } from '../admin/settlements.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { offers, orders, restaurants, settlements } from '../db/schema.js';
import { balance } from '../ledger/ledger.js';

const colomboToday = sql`(date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')`;
const colomboMonday = sql`(date_trunc('week', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')`;

/** A restaurant's and a rider's own view of their money (T11, R10). Read-only. */
export class PayoutsService {
  constructor(
    private readonly db: Database,
    private readonly settlements: SettlementsService,
  ) {}

  private async listFor(party: 'restaurant' | 'rider', partyId: string) {
    const all = await this.settlements.list(party);
    return all.filter((s) => s.partyId === partyId);
  }

  restaurant(auth: AuthContext): Promise<RestaurantPayouts> {
    const tenantId = auth.tenantId!;
    return withScope(this.db, PLATFORM, async (tx) => {
      const [pending] = (
        await tx.execute<{ n: number; cents: string; since: Date | null }>(sql`
          select count(*)::int as n,
                 coalesce(sum(o.items_cents + o.restaurant_fee_cents), 0) as cents,
                 min(o.closed_at) as since
          from ${orders} o
          where o.tenant_id = ${tenantId} and o.status = 'delivered'
            and not exists (
              select 1 from settlement_lines l join ${settlements} s on s.id = l.settlement_id
              where l.order_id = o.id and s.party = 'restaurant')`)
      ).rows;
      return {
        pending: {
          orderCount: pending?.n ?? 0,
          amountCents: Number(pending?.cents ?? 0),
          since: pending?.since ? new Date(pending.since).toISOString() : null,
        },
        statements: await this.listFor('restaurant', tenantId),
      };
    });
  }

  /** One statement, only if it's yours. */
  async statement(auth: AuthContext, id: string): Promise<SettlementDetail> {
    const d = await this.settlements.get(id);
    const mine =
      (d.party === 'restaurant' && d.partyId === auth.tenantId) ||
      (d.party === 'rider' && d.partyId === auth.accountId);
    if (!mine) throw new ApiError('not_found');
    return d;
  }

  async csv(auth: AuthContext, id: string): Promise<string> {
    await this.statement(auth, id);
    return this.settlements.csv(id);
  }

  rider(auth: AuthContext): Promise<RiderEarnings> {
    const riderId = auth.accountId;
    return withScope(this.db, PLATFORM, async (tx) => {
      const pay = (since: ReturnType<typeof sql>) =>
        tx
          .select({
            n: sql<number>`count(*)::int`,
            cents: sql<string>`coalesce(sum(${offers.payoutCents}), 0)`,
          })
          .from(orders)
          .innerJoin(
            offers,
            and(
              eq(offers.orderId, orders.id),
              eq(offers.riderId, riderId),
              eq(offers.outcome, 'accepted'),
            ),
          )
          .where(
            and(
              eq(orders.riderId, riderId),
              eq(orders.status, 'delivered'),
              sql`${orders.closedAt} >= ${since}`,
            ),
          );
      const [[today], [week], recent, owed] = await Promise.all([
        pay(colomboToday),
        pay(colomboMonday),
        tx
          .select({
            orderId: orders.id,
            reference: orders.reference,
            restaurantName: restaurants.name,
            payCents: offers.payoutCents,
            deliveredAt: orders.closedAt,
          })
          .from(orders)
          .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
          .innerJoin(
            offers,
            and(
              eq(offers.orderId, orders.id),
              eq(offers.riderId, riderId),
              eq(offers.outcome, 'accepted'),
            ),
          )
          .where(and(eq(orders.riderId, riderId), eq(orders.status, 'delivered')))
          .orderBy(desc(orders.closedAt))
          .limit(20),
        balance(tx, 'rider_payable', riderId),
      ]);
      return {
        today: { deliveries: today?.n ?? 0, payCents: Number(today?.cents ?? 0) },
        week: { deliveries: week?.n ?? 0, payCents: Number(week?.cents ?? 0) },
        // rider_payable is a credit (negative) while owed.
        owedCents: Math.max(0, -owed),
        recent: recent.map((r) => ({
          ...r,
          deliveredAt: (r.deliveredAt ?? new Date(0)).toISOString(),
        })),
        payouts: await this.listFor('rider', riderId),
      };
    });
  }
}
