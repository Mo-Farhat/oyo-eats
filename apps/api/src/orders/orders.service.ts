import { randomInt } from 'node:crypto';
import {
  canSeeCustomerContact,
  canSeeRiderContact,
  canViewOrder,
  customerStage,
  deliveryFee,
  estimateDeliveryRange,
  haversineMeters,
  initialOrderState,
  orderTotals,
  transition,
  TERMINAL_STATUSES,
  type OrderDetail,
  type OrderSummary,
  type PaymentMethod,
  type PlaceOrderInput,
  type PricedLineResponse,
  type QuoteOrderInput,
  type QuoteResponse,
} from '@oyo/shared';
import { and, asc, count, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { openStates, pointOf } from '../catalog/catalog.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  customerAddresses,
  menuItems,
  modifierGroups,
  modifiers,
  orderEvents,
  orderItems,
  orders,
  payments,
  restaurants,
  riders,
  supportCases,
} from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import type { Routing } from '../routing/routing.js';
import type { FileStorage } from '../storage/storage.js';
import { renderReceipt } from './receipt.js';
import { loadSettings, type BusinessSettings } from '../settings/settings.js';
import { bankTransferInfo, latestSlip } from '../payments/bank-transfer.js';
import { canRate, ratingsFor, rateUntil } from '../reviews/ratings.js';
import { itemChangesFor } from './item-changes.service.js';
import { applyOrderEvent, stateOf, type OrderRow } from './order-events.js';
import { ORDER_QUEUES } from './queues.js';

export { ORDER_QUEUES } from './queues.js';

const MAX_OPEN_ORDERS = 3; // CUS key rules
const MAX_UNPAID_TRANSFERS = 2;
/** Card payments arrive in Milestone 6 behind the payment adapter. */
const ENABLED_METHODS: PaymentMethod[] = ['cod', 'bank_transfer'];
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

interface Priced extends QuoteResponse {
  tenantId: string;
  address: typeof customerAddresses.$inferSelect;
  prepMinutes: number;
}

export class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly routing: Routing,
    private readonly jobs: JobQueue,
    private readonly encryptionKey: Buffer,
    private readonly storage: FileStorage,
    private readonly clock: () => Date = () => new Date(),
  ) {
    jobs.define<{ orderId: string }>(ORDER_QUEUES.restaurantTimeout, ({ orderId }) =>
      this.timeout(orderId, 'restaurant_timed_out'),
    );
    jobs.define<{ orderId: string }>(ORDER_QUEUES.paymentTimeout, ({ orderId }) =>
      this.timeout(orderId, 'payment_expired'),
    );
  }

  /** Prices a draft order exactly as placing it would (CUS-07). No side effects. */
  quote(auth: AuthContext, input: QuoteOrderInput): Promise<QuoteResponse> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const {
        tenantId: _t,
        address: _a,
        prepMinutes: _p,
        ...quote
      } = await this.price(tx, auth.accountId, input, await loadSettings(tx));
      return quote;
    });
  }

  /** Places an order (CUS-07, CUS-08). Totals and the fee are always recomputed here (SEC-23). */
  async place(auth: AuthContext, input: PlaceOrderInput): Promise<OrderDetail> {
    const { order, timers } = await withScope(this.db, PLATFORM, async (tx) => {
      const settings = await loadSettings(tx);
      await this.checkLimits(tx, auth.accountId, input.paymentMethod);
      const priced = await this.price(tx, auth.accountId, input, settings);
      if (!priced.paymentMethods.includes(input.paymentMethod)) {
        throw new ApiError('payment_method_unavailable', { allowed: priced.paymentMethods });
      }

      const state = initialOrderState(input.paymentMethod);
      const order = await this.insertOrder(tx, auth, input, priced, state.status);
      await tx.insert(orderItems).values(
        priced.lines.map((l) => ({
          tenantId: priced.tenantId,
          orderId: order.id,
          menuItemId: l.menuItemId,
          name: l.name,
          unitPriceCents: l.unitPriceCents,
          modifiers: l.modifiers,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
          note: l.note,
        })),
      );
      await tx.insert(payments).values({
        tenantId: priced.tenantId,
        orderId: order.id,
        method: input.paymentMethod,
        amountCents: priced.totalCents,
      });
      await tx.insert(orderEvents).values({
        tenantId: priced.tenantId,
        orderId: order.id,
        type: 'placed',
        actorAccountId: auth.accountId,
        actorRole: 'customer',
        deviceId: auth.deviceId,
        payload: { paymentMethod: input.paymentMethod, totalCents: priced.totalCents },
      });
      return { order, timers: settings.timers };
    });

    // Timers start after commit. COD goes straight to the restaurant; prepaid methods wait for
    // payment first (the restaurant timer for those starts once payment is confirmed).
    if (order.status === 'awaiting_restaurant') {
      await this.jobs.sendAfter(
        ORDER_QUEUES.restaurantTimeout,
        { orderId: order.id },
        timers.restaurantResponseSeconds,
      );
    } else {
      await this.jobs.sendAfter(
        ORDER_QUEUES.paymentTimeout,
        { orderId: order.id },
        timers.slipWindowSeconds,
      );
    }
    return this.get(auth, order.id);
  }

  list(auth: AuthContext): Promise<OrderSummary[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const rows = await tx
        .select({ order: orders, restaurantName: restaurants.name })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(orders.customerId, auth.accountId))
        .orderBy(desc(orders.placedAt))
        .limit(50);
      const counts = rows.length
        ? await tx
            .select({ orderId: orderItems.orderId, n: count() })
            .from(orderItems)
            .where(
              inArray(
                orderItems.orderId,
                rows.map((r) => r.order.id),
              ),
            )
            .groupBy(orderItems.orderId)
        : [];
      const rated = await ratingsFor(
        tx,
        rows.map((r) => r.order.id),
      );
      return rows.map(({ order, restaurantName }) =>
        this.summary(
          order,
          restaurantName,
          Number(counts.find((c) => c.orderId === order.id)?.n ?? 0),
          rated.get(order.id)?.restaurant?.rating ?? null,
        ),
      );
    });
  }

  get(auth: AuthContext, orderId: string): Promise<OrderDetail> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ order: orders, restaurantName: restaurants.name })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(orders.id, orderId));
      if (!row || !canViewOrder(auth, row.order)) throw new ApiError('not_found');
      const { order } = row;

      const [items, events] = await Promise.all([
        tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
        tx
          .select()
          .from(orderEvents)
          .where(eq(orderEvents.orderId, order.id))
          .orderBy(asc(orderEvents.occurredAt), asc(orderEvents.seq)),
      ]);
      const ratings = (await ratingsFor(tx, [order.id])).get(order.id)!;
      const changes = (await itemChangesFor(tx, [order.id])).get(order.id)!;
      const [rider] = order.riderId
        ? await tx
            .select({
              name: accounts.displayName,
              phone: accounts.phoneCiphertext,
              vehicle: riders.vehicleType,
              plate: riders.plate,
            })
            .from(accounts)
            .leftJoin(riders, eq(riders.accountId, accounts.id))
            .where(eq(accounts.id, order.riderId))
        : [];
      const contact = canSeeCustomerContact(auth, order);
      const reveal = (c: Buffer | null) => (contact && c ? decrypt(this.encryptionKey, c) : null);

      return {
        ...this.summary(
          order,
          row.restaurantName,
          items.length,
          ratings.restaurant?.rating ?? null,
        ),
        kitchenStatus: order.kitchenStatus,
        deliveryStatus: order.deliveryStatus,
        lines: items.map((i) => ({
          menuItemId: i.menuItemId,
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          modifiers: i.modifiers as PricedLineResponse['modifiers'],
          lineTotalCents: i.lineTotalCents,
          note: i.note,
        })),
        itemsCents: order.itemsCents,
        deliveryFeeCents: order.deliveryFeeCents,
        restaurantFeeCents: order.restaurantFeeCents,
        deliveryAddress: {
          addressText: reveal(order.deliveryAddressCiphertext),
          note: reveal(order.deliveryNoteCiphertext),
          lat: order.deliveryLocation.y,
          lng: order.deliveryLocation.x,
        },
        prepMinutes: order.prepMinutes,
        timeline: events.map((e) => ({ type: e.type, at: e.occurredAt.toISOString() })),
        canCancel:
          auth.role === 'customer' &&
          transition(stateOf(order), 'cancelled_by_customer', 'customer').ok,
        bankTransfer: await bankTransferInfo(tx, order, await loadSettings(tx), this.clock()),
        rider: rider
          ? {
              name: rider.name.split(' ')[0] ?? rider.name,
              vehicle: rider.vehicle,
              plate: rider.plate,
              phone:
                rider.phone && canSeeRiderContact(auth, order)
                  ? decrypt(this.encryptionKey, rider.phone)
                  : null,
            }
          : null,
        ratings,
        rateUntil: rateUntil(order)?.toISOString() ?? null,
        readyBy: (() => {
          const accepted = [...events].reverse().find((e) => e.type === 'restaurant_accepted');
          return accepted && order.prepMinutes
            ? new Date(accepted.occurredAt.getTime() + order.prepMinutes * 60_000).toISOString()
            : null;
        })(),
        itemChanges: changes,
      };
    });
  }

  /** A PDF receipt for a delivered order (CUS-17), as a 5-minute signed link. */
  async receipt(auth: AuthContext, orderId: string): Promise<{ url: string }> {
    const detail = await this.get(auth, orderId);
    if (detail.status !== 'delivered')
      throw new ApiError('invalid_transition', { status: detail.status });
    const extra = await withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ address: restaurants.addressText, closedAt: orders.closedAt })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(orders.id, orderId));
      return row!;
    });
    const pdf = await renderReceipt({
      reference: detail.reference,
      restaurantName: detail.restaurant.name,
      restaurantAddress: extra.address,
      placedAt: new Date(detail.placedAt),
      deliveredAt: extra.closedAt,
      paymentMethod: detail.paymentMethod,
      lines: detail.lines.map((l) => ({ ...l, modifiers: l.modifiers.map((m) => m.name) })),
      itemsCents: detail.itemsCents,
      deliveryFeeCents: detail.deliveryFeeCents,
      restaurantFeeCents: detail.restaurantFeeCents,
      totalCents: detail.totalCents,
    });
    const key = `receipts/${orderId}.pdf`;
    await this.storage.put(key, pdf, 'application/pdf');
    return { url: await this.storage.signedUrl(key, 300) };
  }

  /** Customers cancel freely until the restaurant accepts (CUS-14). */
  async cancel(auth: AuthContext, orderId: string): Promise<OrderDetail> {
    await withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order || order.customerId !== auth.accountId) throw new ApiError('not_found');
      await applyOrderEvent(tx, orderId, 'cancelled_by_customer', {
        role: 'customer',
        accountId: auth.accountId,
        deviceId: auth.deviceId,
      });
      // Money may already be in our account: a bank transfer can't be refunded automatically, so
      // open a case for the office to send it back (refund rules, PRD section 9).
      const slip =
        order.paymentMethod === 'bank_transfer' ? await latestSlip(tx, orderId) : undefined;
      if (slip && (slip.status === 'pending' || slip.status === 'approved')) {
        await tx.insert(supportCases).values({
          orderId,
          tenantId: order.tenantId,
          reporterId: auth.accountId,
          type: 'refund_bank_transfer',
          description: `Customer cancelled before the restaurant accepted. Refund ${order.totalCents} cents by bank transfer.`,
        });
      }
    });
    return this.get(auth, orderId);
  }

  /** Timer handler: applies the expiry if the order is still waiting; otherwise does nothing. */
  private async timeout(
    orderId: string,
    event: 'restaurant_timed_out' | 'payment_expired',
  ): Promise<void> {
    const recheck = await withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order || !transition(stateOf(order), event, 'system').ok) return false;
      // A slip uploaded in time but not yet reviewed holds the order: the customer has paid, so
      // cancelling would strand their money. Check again until the office decides.
      if (event === 'payment_expired' && (await latestSlip(tx, orderId))?.status === 'pending')
        return true;
      await applyOrderEvent(tx, orderId, event, { role: 'system', accountId: null });
      return false;
    });
    if (recheck) await this.jobs.sendAfter(ORDER_QUEUES.paymentTimeout, { orderId }, 10 * 60);
  }

  private summary(
    order: OrderRow,
    restaurantName: string,
    itemCount: number,
    myRating: number | null,
  ): OrderSummary {
    return {
      myRating,
      canRate: canRate(order, this.clock()),
      id: order.id,
      reference: order.reference,
      restaurant: { id: order.tenantId, name: restaurantName },
      status: order.status,
      stage: customerStage(stateOf(order)),
      paymentMethod: order.paymentMethod,
      totalCents: order.totalCents,
      itemCount,
      placedAt: order.placedAt.toISOString(),
    };
  }

  private async checkLimits(tx: Tx, customerId: string, method: PaymentMethod) {
    const open = and(
      eq(orders.customerId, customerId),
      notInArray(orders.status, [...TERMINAL_STATUSES]),
    );
    const [{ n: openCount }] = (await tx.select({ n: count() }).from(orders).where(open)) as [
      { n: number },
    ];
    if (openCount >= MAX_OPEN_ORDERS)
      throw new ApiError('too_many_open_orders', { limit: MAX_OPEN_ORDERS });
    if (method === 'bank_transfer') {
      const [{ n: unpaid }] = (await tx
        .select({ n: count() })
        .from(orders)
        .where(
          and(
            eq(orders.customerId, customerId),
            eq(orders.paymentMethod, 'bank_transfer'),
            eq(orders.status, 'awaiting_payment'),
          ),
        )) as [{ n: number }];
      if (unpaid >= MAX_UNPAID_TRANSFERS) {
        throw new ApiError('too_many_unpaid_transfers', { limit: MAX_UNPAID_TRANSFERS });
      }
    }
  }

  private async insertOrder(
    tx: Tx,
    auth: AuthContext,
    input: PlaceOrderInput,
    priced: Priced,
    status: OrderRow['status'],
  ): Promise<OrderRow> {
    // 32^6 references: a clash is very unlikely, but retry in a savepoint if one happens.
    for (let attempt = 0; ; attempt++) {
      const reference = Array.from(
        { length: 6 },
        () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)],
      ).join('');
      try {
        return await tx.transaction(async (sp) => {
          const [order] = await sp
            .insert(orders)
            .values({
              tenantId: priced.tenantId,
              reference,
              customerId: auth.accountId,
              paymentMethod: input.paymentMethod,
              status,
              deliveryLocation: priced.address.location,
              deliveryAddressCiphertext: priced.address.addressCiphertext,
              deliveryNoteCiphertext: priced.address.noteCiphertext,
              routeDistanceMeters: priced.routeMeters,
              feeSettings: {
                ...(await loadSettings(sp)).deliveryFee,
                routeMeters: priced.routeMeters,
              },
              itemsCents: priced.itemsCents,
              deliveryFeeCents: priced.deliveryFeeCents,
              restaurantFeeCents: priced.restaurantFeeCents,
              totalCents: priced.totalCents,
            })
            .returning();
          return order!;
        });
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (code !== '23505' || attempt >= 3) throw error;
      }
    }
  }

  /**
   * Validates and prices a draft against current data: restaurant open and in range, items
   * available, modifier rules met, fee from the routed distance, minimum order and COD limit.
   */
  private async price(
    tx: Tx,
    customerId: string,
    input: QuoteOrderInput,
    settings: BusinessSettings,
  ): Promise<Priced> {
    const now = this.clock();
    const [restaurant] = await tx
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, input.restaurantId));
    if (!restaurant) throw new ApiError('not_found', { what: 'restaurant' });
    if (!(await openStates(tx, [restaurant], now)).get(restaurant.id))
      throw new ApiError('restaurant_closed');

    const [address] = await tx
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.id, input.addressId),
          eq(customerAddresses.customerId, customerId),
          isNull(customerAddresses.deletedAt),
        ),
      );
    if (!address) throw new ApiError('not_found', { what: 'address' });
    const to = { lat: address.location.y, lng: address.location.x };
    if (haversineMeters(pointOf(restaurant), to) > settings.deliveryFee.maxRadiusMeters) {
      throw new ApiError('out_of_range', { maxRadiusMeters: settings.deliveryFee.maxRadiusMeters });
    }

    const itemIds = [...new Set(input.items.map((l) => l.menuItemId))];
    const items = await tx
      .select()
      .from(menuItems)
      .where(and(inArray(menuItems.id, itemIds), eq(menuItems.tenantId, restaurant.id)));
    const groups = items.length
      ? await tx
          .select()
          .from(modifierGroups)
          .where(
            inArray(
              modifierGroups.menuItemId,
              items.map((i) => i.id),
            ),
          )
      : [];
    const options = groups.length
      ? await tx
          .select()
          .from(modifiers)
          .where(
            inArray(
              modifiers.groupId,
              groups.map((g) => g.id),
            ),
          )
      : [];

    const lines: PricedLineResponse[] = input.items.map((line) => {
      const item = items.find((i) => i.id === line.menuItemId);
      if (!item || item.approvalStatus !== 'approved' || item.archivedAt || item.soldOut) {
        throw new ApiError('item_unavailable', { menuItemId: line.menuItemId });
      }
      const itemGroups = groups.filter((g) => g.menuItemId === item.id);
      const chosen = [...new Set(line.modifierIds)].map((id) => {
        const option = options.find(
          (o) => o.id === id && itemGroups.some((g) => g.id === o.groupId),
        );
        if (!option)
          throw new ApiError('modifier_invalid', { menuItemId: item.id, modifierId: id });
        if (option.soldOut)
          throw new ApiError('item_unavailable', { menuItemId: item.id, modifierId: id });
        return option;
      });
      if (chosen.length !== line.modifierIds.length)
        throw new ApiError('modifier_invalid', { menuItemId: item.id });
      for (const g of itemGroups) {
        const n = chosen.filter((o) => o.groupId === g.id).length;
        if (n < g.minSelect || n > g.maxSelect) {
          throw new ApiError('modifier_invalid', {
            menuItemId: item.id,
            groupId: g.id,
            min: g.minSelect,
            max: g.maxSelect,
          });
        }
      }
      const unit = item.priceCents + chosen.reduce((sum, o) => sum + o.priceCents, 0);
      return {
        menuItemId: item.id,
        name: item.name,
        quantity: line.quantity,
        unitPriceCents: item.priceCents,
        modifiers: chosen.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents })),
        lineTotalCents: unit * line.quantity,
        note: line.note ?? null,
      };
    });

    const routeMeters = await this.routing.routeMeters(pointOf(restaurant), to);
    const totals = orderTotals({
      lines: lines.map((l) => ({
        unitPriceCents: l.unitPriceCents,
        modifierPriceCents: l.modifiers.map((m) => m.priceCents),
        quantity: l.quantity,
      })),
      deliveryFeeCents: deliveryFee(routeMeters, settings.deliveryFee),
    });
    if (
      settings.minimumOrderCents !== undefined &&
      totals.itemsCents < settings.minimumOrderCents
    ) {
      throw new ApiError('minimum_order', { minimumCents: settings.minimumOrderCents });
    }

    // COD is hidden above the limit (CUS-08) and for customers the office took it from (ADM-15).
    // Bank transfer needs the business account to be set (docs/NEEDS-YOU.md).
    const [customer] = await tx
      .select({ codBlocked: accounts.codBlocked })
      .from(accounts)
      .where(eq(accounts.id, customerId));
    const paymentMethods = ENABLED_METHODS.filter(
      (m) =>
        (m !== 'cod' ||
          (!customer?.codBlocked &&
            (settings.codLimitCents === undefined ||
              totals.totalCents <= settings.codLimitCents))) &&
        (m !== 'bank_transfer' || settings.bankDetails !== undefined),
    );

    return {
      restaurantId: restaurant.id,
      tenantId: restaurant.id,
      address,
      prepMinutes: restaurant.prepMinutes,
      lines,
      ...totals,
      routeMeters,
      baseFeeCents: settings.deliveryFee.baseFeeCents,
      perKmCents: settings.deliveryFee.perKmCents,
      eta: estimateDeliveryRange(restaurant.prepMinutes, routeMeters),
      paymentMethods,
    };
  }
}
