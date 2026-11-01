import {
  canSeeCustomerContact,
  MAX_CONSECUTIVE_MISSES,
  type DeliverInput,
  type RiderJob,
  type RiderLocationInput,
  type RiderOffer,
  type RiderState,
} from '@oyo/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  cashHandovers,
  offers,
  orderItems,
  orders,
  payments,
  restaurants,
  riderLocations,
  riders,
} from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { loadSettings } from '../settings/settings.js';
import { postDelivery, postRiderPay } from '../ledger/ledger.js';
import { applyOrderEvent } from '../orders/order-events.js';
import { activeJobs, cashHeld } from './riders.js';
import { DISPATCH_QUEUES } from './dispatch.service.js';

/** The rider's side of a job (RID-02 to RID-08). Every call is the rider's own record only. */
export class RiderService {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly encryptionKey: Buffer,
    private readonly clock: () => Date = () => new Date(),
  ) {
    jobs.define<{ offerId: string }>(DISPATCH_QUEUES.offerExpire, ({ offerId }) =>
      this.expire(offerId),
    );
  }

  private async me(tx: Tx, auth: AuthContext) {
    const [rider] = await tx
      .select()
      .from(riders)
      .where(eq(riders.accountId, auth.accountId))
      .for('update');
    if (!rider) throw new ApiError('not_found', { what: 'rider profile' });
    return rider;
  }

  private actor(auth: AuthContext) {
    return { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId };
  }

  state(auth: AuthContext): Promise<RiderState> {
    const now = this.clock();
    return withScope(this.db, PLATFORM, async (tx) => {
      const rider = await this.me(tx, auth);
      const [pending] = await tx
        .select({ offer: offers, order: orders, restaurant: restaurants })
        .from(offers)
        .innerJoin(orders, eq(orders.id, offers.orderId))
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(
          and(
            eq(offers.riderId, auth.accountId),
            eq(offers.outcome, 'pending'),
            gt(offers.expiresAt, now),
          ),
        )
        .orderBy(desc(offers.sentAt))
        .limit(1);
      const jobRows = await tx
        .select({
          order: orders,
          restaurant: restaurants,
          customerName: accounts.displayName,
          phone: accounts.phoneCiphertext,
        })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .innerJoin(accounts, eq(accounts.id, orders.customerId))
        .where(
          and(eq(orders.riderId, auth.accountId), inArray(orders.status, ['active', 'picked_up'])),
        );
      const ids = [...jobRows.map((j) => j.order.id), ...(pending ? [pending.order.id] : [])];
      const [counts, accepted] = ids.length
        ? await Promise.all([
            tx
              .select({
                orderId: orderItems.orderId,
                n: sql<number>`sum(${orderItems.quantity})::int`,
              })
              .from(orderItems)
              .where(inArray(orderItems.orderId, ids))
              .groupBy(orderItems.orderId),
            tx
              .select({ orderId: offers.orderId, payout: offers.payoutCents })
              .from(offers)
              .where(
                and(
                  eq(offers.riderId, auth.accountId),
                  eq(offers.outcome, 'accepted'),
                  inArray(offers.orderId, ids),
                ),
              ),
          ])
        : [[], []];
      const count = (id: string) => counts.find((c) => c.orderId === id)?.n ?? 0;
      const reveal = (c: Buffer | null) => (c ? decrypt(this.encryptionKey, c) : null);

      const offer: RiderOffer | null = pending
        ? {
            id: pending.offer.id,
            orderId: pending.order.id,
            reference: pending.order.reference,
            restaurant: { name: pending.restaurant.name, address: pending.restaurant.addressText },
            dropoffDistanceMeters: pending.order.routeDistanceMeters,
            itemCount: count(pending.order.id),
            collectCents: pending.order.paymentMethod === 'cod' ? pending.order.totalCents : 0,
            payoutCents: pending.offer.payoutCents,
            expiresAt: pending.offer.expiresAt.toISOString(),
          }
        : null;

      const jobs = jobRows.map(({ order, restaurant, customerName, phone }): RiderJob => {
        const contact = canSeeCustomerContact(auth, order);
        return {
          orderId: order.id,
          reference: order.reference,
          status: order.status,
          kitchenStatus: order.kitchenStatus,
          restaurant: {
            name: restaurant.name,
            address: restaurant.addressText,
            lat: restaurant.location.y,
            lng: restaurant.location.x,
          },
          customer: {
            firstName: customerName.trim().split(/\s+/)[0] || 'Customer',
            phone: contact ? reveal(phone) : null,
            address: contact ? reveal(order.deliveryAddressCiphertext) : null,
            note: contact ? reveal(order.deliveryNoteCiphertext) : null,
            lat: order.deliveryLocation.y,
            lng: order.deliveryLocation.x,
          },
          itemCount: count(order.id),
          paymentMethod: order.paymentMethod,
          collectCents: order.paymentMethod === 'cod' ? order.totalCents : 0,
          payoutCents: accepted.find((a) => a.orderId === order.id)?.payout ?? 0,
        };
      });

      const [settings, handoverRows] = await Promise.all([
        loadSettings(tx),
        tx
          .select({
            handover: cashHandovers,
            recordedBy: accounts.displayName,
          })
          .from(cashHandovers)
          .innerJoin(accounts, eq(accounts.id, cashHandovers.recordedBy))
          .where(eq(cashHandovers.riderId, auth.accountId))
          .orderBy(desc(cashHandovers.recordedAt))
          .limit(10),
      ]);
      return {
        online: rider.online,
        paused: rider.paused,
        consecutiveMisses: rider.consecutiveMisses,
        cashHeldCents: (await cashHeld(tx, [auth.accountId])).get(auth.accountId) ?? 0,
        cashCapCents: settings.riderCaps.cashCapCents,
        handovers: handoverRows.map(({ handover: h, recordedBy }) => ({
          id: h.id,
          amountCents: h.amountCents,
          expectedCents: h.expectedCents,
          varianceReason: h.varianceReason,
          recordedBy,
          countersignedBy: h.countersignedBy ? 'Owner' : null,
          recordedAt: h.recordedAt.toISOString(),
        })),
        offer,
        jobs,
      };
    });
  }

  /** Going online starts location sharing; going offline is blocked mid-job (RID-02). */
  setOnline(auth: AuthContext, online: boolean): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.me(tx, auth);
      if (!online && ((await activeJobs(tx, [auth.accountId])).get(auth.accountId) ?? 0) > 0)
        throw new ApiError('rider_busy');
      await tx
        .update(riders)
        .set({ online, ...(online ? { consecutiveMisses: 0 } : {}) })
        .where(eq(riders.accountId, auth.accountId));
    });
  }

  /** A position report (RID-10). Mock locations are kept and flagged for dispatch (SEC-28). */
  location(auth: AuthContext, input: RiderLocationInput): Promise<void> {
    const now = this.clock();
    return withScope(this.db, PLATFORM, async (tx) => {
      const rider = await this.me(tx, auth);
      if (!rider.online) return;
      const point = { x: input.lng, y: input.lat };
      await tx
        .update(riders)
        .set({ lastLocation: point, lastSeenAt: now })
        .where(eq(riders.accountId, auth.accountId));
      await tx.insert(riderLocations).values({
        riderId: auth.accountId,
        location: point,
        batteryPercent: input.batteryPercent,
        mock: input.mock ?? false,
        recordedAt: now,
      });
    });
  }

  private async myOffer(tx: Tx, auth: AuthContext, offerId: string) {
    const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for('update');
    if (!offer?.orderId || offer.riderId !== auth.accountId) throw new ApiError('not_found');
    if (offer.outcome !== 'pending')
      throw new ApiError('invalid_transition', { outcome: offer.outcome });
    return offer as typeof offer & { orderId: string };
  }

  /** Accept inside the window: the order is now this rider's (RID-03). */
  accept(auth: AuthContext, offerId: string): Promise<void> {
    const now = this.clock();
    return withScope(this.db, PLATFORM, async (tx) => {
      const offer = await this.myOffer(tx, auth, offerId);
      if (offer.expiresAt <= now) throw new ApiError('offer_expired');
      await tx
        .update(offers)
        .set({ outcome: 'accepted', respondedAt: now })
        .where(eq(offers.id, offerId));
      await tx.update(orders).set({ riderId: auth.accountId }).where(eq(orders.id, offer.orderId));
      await applyOrderEvent(tx, offer.orderId, 'offer_accepted', this.actor(auth), { offerId });
      await tx
        .update(riders)
        .set({ consecutiveMisses: 0 })
        .where(eq(riders.accountId, auth.accountId));
    });
  }

  /** Decline with a reason; this order is never re-offered to this rider automatically (section 5). */
  decline(auth: AuthContext, offerId: string, reason: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const offer = await this.myOffer(tx, auth, offerId);
      await tx
        .update(offers)
        .set({ outcome: 'declined', reason, respondedAt: this.clock() })
        .where(eq(offers.id, offerId));
      await applyOrderEvent(tx, offer.orderId, 'offer_declined', this.actor(auth), {
        offerId,
        reason,
      });
    });
  }

  /** Offer timer: a miss; three in a row take the rider offline and alert dispatch (RID-04). */
  private async expire(offerId: string): Promise<void> {
    await withScope(this.db, PLATFORM, async (tx) => {
      const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for('update');
      if (!offer?.orderId || offer.outcome !== 'pending') return;
      await tx
        .update(offers)
        .set({ outcome: 'expired', respondedAt: this.clock() })
        .where(eq(offers.id, offerId));
      await applyOrderEvent(
        tx,
        offer.orderId,
        'offer_expired',
        { role: 'system', accountId: null },
        { offerId },
      );
      const [rider] = await tx
        .update(riders)
        .set({ consecutiveMisses: sql`${riders.consecutiveMisses} + 1` })
        .where(eq(riders.accountId, offer.riderId))
        .returning();
      if (rider && rider.consecutiveMisses >= MAX_CONSECUTIVE_MISSES && rider.online) {
        await tx.update(riders).set({ online: false }).where(eq(riders.accountId, offer.riderId));
        await tx.insert(auditLog).values({
          actorRole: 'system',
          action: 'rider.auto_offline',
          targetType: 'rider',
          targetId: offer.riderId,
          after: { consecutiveMisses: rider.consecutiveMisses },
        });
      }
    });
  }

  private async myJob(tx: Tx, auth: AuthContext, orderId: string) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order || order.riderId !== auth.accountId) throw new ApiError('not_found');
    return order;
  }

  /** Pickup after checking the order number and items (RID-06); needs the food ready. */
  pickup(auth: AuthContext, orderId: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await this.myJob(tx, auth, orderId);
      await applyOrderEvent(tx, orderId, 'picked_up', this.actor(auth));
    });
  }

  /** Delivered (RID-08). COD needs the cash taken; any difference needs a reason. */
  deliver(auth: AuthContext, orderId: string, input: DeliverInput): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const order = await this.myJob(tx, auth, orderId);
      if (order.paymentMethod === 'cod') {
        if (input.cashCollectedCents === undefined)
          throw new ApiError('cash_required', { expectedCents: order.totalCents });
        if (input.cashCollectedCents !== order.totalCents && !input.varianceReason) {
          throw new ApiError('variance_reason_required', { expectedCents: order.totalCents });
        }
        await tx
          .update(orders)
          .set({
            cashCollectedCents: input.cashCollectedCents,
            cashVarianceReason: input.varianceReason ?? null,
          })
          .where(eq(orders.id, orderId));
        await tx
          .update(payments)
          .set({ status: 'confirmed', confirmedAt: this.clock() })
          .where(and(eq(payments.orderId, orderId), eq(payments.method, 'cod')));
      }
      const delivered = await applyOrderEvent(tx, orderId, 'delivered', this.actor(auth), {
        cashCollectedCents: input.cashCollectedCents ?? null,
      });
      // The money side, in the same transaction as the status change (PRD section 9).
      await postDelivery(tx, delivered, auth.accountId);
      const [accepted] = await tx
        .select({ payoutCents: offers.payoutCents })
        .from(offers)
        .where(
          and(
            eq(offers.orderId, orderId),
            eq(offers.riderId, auth.accountId),
            eq(offers.outcome, 'accepted'),
          ),
        );
      if (accepted) {
        await postRiderPay(tx, {
          orderId,
          riderId: auth.accountId,
          payoutCents: accepted.payoutCents,
          actorId: auth.accountId,
        });
      }
    });
  }
}
