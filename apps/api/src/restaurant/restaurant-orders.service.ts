import {
  colomboParts,
  type AcceptOrderInput,
  type DelayOrderInput,
  type ItemChange,
  type RejectOrderInput,
  type RestaurantBoard,
  type RestaurantOrder,
} from '@oyo/shared';
import { and, asc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { scopeFor } from '../auth/scope.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import {
  accounts,
  menuItems,
  orderEvents,
  orderItems,
  orders,
  restaurants,
  riders,
  supportCases,
} from '../db/schema.js';
import { hasPendingItemChange, itemChangesFor } from '../orders/item-changes.service.js';
import { applyOrderEvent, type OrderRow } from '../orders/order-events.js';
import { latestSlip } from '../payments/bank-transfer.js';
import { loadSettings } from '../settings/settings.js';

/** Far-future pause: "closed until reopened" from the board's Open switch (RES-10). */
export const CLOSED_UNTIL_REOPENED = new Date('2100-01-01T00:00:00Z');

/** Midnight in Asia/Colombo (UTC+5:30, no DST) for "today" on the Done tab. */
function startOfColomboDay(now: Date): Date {
  const { date } = colomboParts(now);
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 330 * 60_000);
}

/**
 * The restaurant face (RES-02 to RES-06). Order data is read in tenant scope, so RLS limits it to
 * the caller's restaurant; customer first names, rider details and settings are then read in
 * platform scope for orders already proven to be theirs.
 */
export class RestaurantOrdersService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async board(auth: AuthContext): Promise<RestaurantBoard> {
    const now = this.clock();
    const today = startOfColomboDay(now);
    const scope = scopeFor(auth);

    const own = await withScope(this.db, scope, async (tx) => {
      const [restaurant] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, auth.tenantId!));
      if (!restaurant) throw new ApiError('not_found');
      // The kitchen never sees unpaid bank transfers (section 6).
      const rows = await tx
        .select()
        .from(orders)
        .where(
          or(
            inArray(orders.status, ['awaiting_restaurant', 'active']),
            and(isNotNull(orders.closedAt), gte(orders.closedAt, today)),
            and(eq(orders.status, 'picked_up'), gte(orders.placedAt, today)),
          ),
        )
        .orderBy(asc(orders.placedAt));
      const ids = rows.map((o) => o.id);
      const [items, events, changes] = ids.length
        ? await Promise.all([
            tx.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
            tx
              .select()
              .from(orderEvents)
              .where(
                and(
                  inArray(orderEvents.orderId, ids),
                  inArray(orderEvents.type, [
                    'placed',
                    'slip_approved',
                    'payment_confirmed',
                    'restaurant_accepted',
                    'marked_ready',
                  ]),
                ),
              )
              .orderBy(asc(orderEvents.occurredAt), asc(orderEvents.seq)),
            itemChangesFor(tx, ids),
          ])
        : [[], [], new Map<string, ItemChange[]>()];
      return { restaurant, rows, items, events, changes };
    });

    const extra = await withScope(this.db, PLATFORM, async (tx) => {
      const settings = await loadSettings(tx);
      const customerIds = [...new Set(own.rows.map((o) => o.customerId))];
      const riderIds = [
        ...new Set(own.rows.map((o) => o.riderId).filter((id): id is string => !!id)),
      ];
      const [customers, riderRows] = await Promise.all([
        customerIds.length
          ? tx
              .select({ id: accounts.id, name: accounts.displayName })
              .from(accounts)
              .where(inArray(accounts.id, customerIds))
          : [],
        riderIds.length
          ? tx
              .select({
                id: riders.accountId,
                name: accounts.displayName,
                vehicle: riders.vehicleType,
                plate: riders.plate,
              })
              .from(riders)
              .innerJoin(accounts, eq(accounts.id, riders.accountId))
              .where(inArray(riders.accountId, riderIds))
          : [],
      ]);
      return { settings, customers, riderRows };
    });

    const view = (o: OrderRow): RestaurantOrder => {
      const evs = own.events.filter((e) => e.orderId === o.id);
      const last = (types: string[]) =>
        [...evs].reverse().find((e) => types.includes(e.type))?.occurredAt ?? null;
      const releasedAt = last(['slip_approved', 'payment_confirmed', 'placed']);
      const acceptedAt = last(['restaurant_accepted']);
      const readyAt = last(['marked_ready']);
      const lines = own.items.filter((i) => i.orderId === o.id);
      const rider = extra.riderRows.find((r) => r.id === o.riderId);
      const name = extra.customers
        .find((c) => c.id === o.customerId)
        ?.name.trim()
        .split(/\s+/)[0];
      return {
        id: o.id,
        reference: o.reference,
        customerFirstName: name || 'Customer',
        status: o.status,
        kitchenStatus: o.kitchenStatus,
        deliveryStatus: o.deliveryStatus,
        paymentMethod: o.paymentMethod,
        paid: o.paymentMethod !== 'cod',
        lines: lines.map((l) => ({
          id: l.id,
          menuItemId: l.menuItemId,
          name: l.name,
          quantity: l.quantity,
          modifiers: (l.modifiers as { name: string }[]).map((m) => m.name),
          note: l.note,
          lineTotalCents: l.lineTotalCents,
        })),
        itemCount: lines.reduce((n, l) => n + l.quantity, 0),
        itemsCents: o.itemsCents,
        placedAt: o.placedAt.toISOString(),
        respondBy:
          o.status === 'awaiting_restaurant' && releasedAt
            ? new Date(
                releasedAt.getTime() + extra.settings.timers.restaurantResponseSeconds * 1000,
              ).toISOString()
            : null,
        acceptedAt: acceptedAt?.toISOString() ?? null,
        prepMinutes: o.prepMinutes,
        readyBy:
          acceptedAt && o.prepMinutes
            ? new Date(acceptedAt.getTime() + o.prepMinutes * 60_000).toISOString()
            : null,
        readyAt: readyAt?.toISOString() ?? null,
        rider: rider ? { name: rider.name, vehicle: rider.vehicle, plate: rider.plate } : null,
        itemChanges: own.changes.get(o.id) ?? [],
      };
    };

    const all = own.rows.map(view);
    return {
      restaurant: {
        id: own.restaurant.id,
        name: own.restaurant.name,
        open: !own.restaurant.pausedUntil || own.restaurant.pausedUntil <= now,
      },
      new: all.filter((o) => o.status === 'awaiting_restaurant'),
      preparing: all.filter((o) => o.status === 'active' && o.kitchenStatus === 'preparing'),
      ready: all.filter((o) => o.status === 'active' && o.kitchenStatus === 'ready'),
      done: all
        .filter((o) => o.status !== 'awaiting_restaurant' && o.status !== 'active')
        .reverse(),
    };
  }

  private actor(auth: AuthContext) {
    return { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId };
  }

  /** Accept with a prep time (RES-04). Dispatch can start finding a rider straight away. */
  accept(auth: AuthContext, orderId: string, input: AcceptOrderInput): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      await applyOrderEvent(tx, orderId, 'restaurant_accepted', this.actor(auth), {
        prepMinutes: input.prepMinutes,
      });
      await tx.update(orders).set({ prepMinutes: input.prepMinutes }).where(eq(orders.id, orderId));
    });
  }

  /** Reject with a reason (RES-04). Unavailable items can be marked sold out in the same step. */
  async reject(auth: AuthContext, orderId: string, input: RejectOrderInput): Promise<void> {
    const order = await withScope(this.db, scopeFor(auth), async (tx) => {
      const row = await applyOrderEvent(tx, orderId, 'restaurant_rejected', this.actor(auth), {
        reason: input.reason,
        note: input.note ?? null,
      });
      if (input.reason === 'item_unavailable' && input.soldOutItemIds.length) {
        await tx
          .update(menuItems)
          .set({ soldOut: true })
          .where(
            and(eq(menuItems.tenantId, row.tenantId), inArray(menuItems.id, input.soldOutItemIds)),
          );
      }
      return row;
    });
    // A paid bank transfer must go back by hand (refund rules, section 9).
    if (order.paymentMethod === 'bank_transfer') {
      await withScope(this.db, PLATFORM, async (tx) => {
        if ((await latestSlip(tx, orderId))?.status !== 'approved') return;
        await tx.insert(supportCases).values({
          orderId,
          tenantId: order.tenantId,
          reporterId: auth.accountId,
          type: 'refund_bank_transfer',
          description: `Restaurant rejected (${input.reason}). Refund ${order.totalCents} cents by bank transfer.`,
        });
      });
    }
  }

  /** Mark ready (RES-06): dispatch and the rider see it on their next refresh. */
  ready(auth: AuthContext, orderId: string): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      // The customer is still choosing what replaces an unavailable item (RES-05).
      if (await hasPendingItemChange(tx, orderId)) throw new ApiError('item_change_pending');
      await applyOrderEvent(tx, orderId, 'marked_ready', this.actor(auth));
    });
  }

  /** Running late: push the promised time back; dispatch sees the event (T05). */
  delay(auth: AuthContext, orderId: string, input: DelayOrderInput): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw new ApiError('not_found');
      if (order.status !== 'active' || order.kitchenStatus !== 'preparing' || !order.prepMinutes) {
        throw new ApiError('invalid_transition', { status: order.status });
      }
      await tx
        .update(orders)
        .set({ prepMinutes: order.prepMinutes + input.minutes })
        .where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({
        tenantId: order.tenantId,
        orderId,
        type: 'prep_delayed',
        actorAccountId: auth.accountId,
        actorRole: auth.role,
        deviceId: auth.deviceId,
        payload: { minutes: input.minutes },
      });
    });
  }

  /** The board's Open switch: off pauses new orders until switched back on (RES-10). */
  /** Open switch and pause (RES-10): closed until reopened, or for 15, 30 or 60 minutes. */
  setOpen(auth: AuthContext, open: boolean, minutes?: number): Promise<void> {
    return withScope(this.db, scopeFor(auth), async (tx) => {
      const until = open
        ? null
        : minutes
          ? new Date(Date.now() + minutes * 60_000)
          : CLOSED_UNTIL_REOPENED;
      await tx
        .update(restaurants)
        .set({ pausedUntil: until })
        .where(eq(restaurants.id, auth.tenantId!));
    });
  }
}
