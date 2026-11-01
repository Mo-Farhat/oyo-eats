import {
  colomboParts,
  haversineMeters,
  riderIneligibility,
  riderPayout,
  type AssignmentLock,
  type CandidateRider,
  type DispatchBoard,
  type DispatchOrder,
} from '@oyo/shared';
import { and, asc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  assignmentLocks,
  offers,
  orderEvents,
  orderItems,
  orders,
  restaurants,
  riders,
} from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { applyOrderEvent } from '../orders/order-events.js';
import { loadSettings } from '../settings/settings.js';
import { activeJobs, cashHeld } from './riders.js';

export const DISPATCH_QUEUES = { offerExpire: 'offer.expire' } as const;
const LOCK_MS = 30_000;

function startOfColomboDay(now: Date): Date {
  return new Date(new Date(`${colomboParts(now).date}T00:00:00Z`).getTime() - 330 * 60_000);
}

/** Manual dispatch (ADM-01, ADM-03, ADM-05, section 8): one offer to one rider at a time. */
export class DispatchService {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  board(): Promise<DispatchBoard> {
    const now = this.clock();
    return withScope(this.db, PLATFORM, async (tx) => {
      const settings = await loadSettings(tx);
      const rows = await tx
        .select({
          order: orders,
          restaurantName: restaurants.name,
          customerName: accounts.displayName,
        })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .innerJoin(accounts, eq(accounts.id, orders.customerId))
        .where(
          or(
            inArray(orders.status, ['awaiting_restaurant', 'active', 'picked_up']),
            and(isNotNull(orders.closedAt), gte(orders.closedAt, startOfColomboDay(now))),
          ),
        )
        .orderBy(asc(orders.placedAt));
      const ids = rows.map((r) => r.order.id);
      const [items, accepted, pending] = ids.length
        ? await Promise.all([
            tx
              .select({ orderId: orderItems.orderId, quantity: orderItems.quantity })
              .from(orderItems)
              .where(inArray(orderItems.orderId, ids)),
            tx
              .select({ orderId: orderEvents.orderId, at: orderEvents.occurredAt })
              .from(orderEvents)
              .where(
                and(inArray(orderEvents.orderId, ids), eq(orderEvents.type, 'restaurant_accepted')),
              ),
            tx
              .select({ offer: offers, riderName: accounts.displayName })
              .from(offers)
              .innerJoin(accounts, eq(accounts.id, offers.riderId))
              .where(and(inArray(offers.orderId, ids), eq(offers.outcome, 'pending'))),
          ])
        : [[], [], []];
      const riderIds = [
        ...new Set(rows.map((r) => r.order.riderId).filter((x): x is string => !!x)),
      ];
      const riderNames = riderIds.length
        ? await tx
            .select({ id: accounts.id, name: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, riderIds))
        : [];

      const view = (r: (typeof rows)[number]): DispatchOrder => {
        const o = r.order;
        const acceptedAt = accepted.find((a) => a.orderId === o.id)?.at ?? null;
        const offer = pending.find((p) => p.offer.orderId === o.id);
        return {
          id: o.id,
          reference: o.reference,
          restaurant: { id: o.tenantId, name: r.restaurantName },
          customerFirstName: r.customerName.trim().split(/\s+/)[0] || 'Customer',
          status: o.status,
          kitchenStatus: o.kitchenStatus,
          deliveryStatus: o.deliveryStatus,
          paymentMethod: o.paymentMethod,
          totalCents: o.totalCents,
          itemCount: items.filter((i) => i.orderId === o.id).reduce((n, i) => n + i.quantity, 0),
          placedAt: o.placedAt.toISOString(),
          acceptedAt: acceptedAt?.toISOString() ?? null,
          readyBy:
            acceptedAt && o.prepMinutes
              ? new Date(acceptedAt.getTime() + o.prepMinutes * 60_000).toISOString()
              : null,
          late:
            o.status === 'active' &&
            o.deliveryStatus === 'unassigned' &&
            !!acceptedAt &&
            now.getTime() - acceptedAt.getTime() > settings.timers.unassignedAlertSeconds * 1000,
          rider: o.riderId
            ? { id: o.riderId, name: riderNames.find((n) => n.id === o.riderId)?.name ?? 'Rider' }
            : null,
          offer: offer
            ? {
                id: offer.offer.id,
                riderId: offer.offer.riderId,
                riderName: offer.riderName,
                expiresAt: offer.offer.expiresAt.toISOString(),
              }
            : null,
        };
      };
      const all = rows.map(view);
      return {
        awaitingRestaurant: all.filter((o) => o.status === 'awaiting_restaurant'),
        unassigned: all.filter((o) => o.status === 'active' && o.deliveryStatus !== 'assigned'),
        assigned: all.filter((o) => o.status === 'active' && o.deliveryStatus === 'assigned'),
        outForDelivery: all.filter((o) => o.status === 'picked_up'),
        doneToday: all
          .filter((o) => !['awaiting_restaurant', 'active', 'picked_up'].includes(o.status))
          .reverse(),
      };
    });
  }

  /** Riders for an order, eligible first, sorted by distance, active jobs, cash held (section 8 rule 3). */
  candidates(orderId: string): Promise<CandidateRider[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ order: orders, location: restaurants.location })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(orders.id, orderId));
      if (!row) throw new ApiError('not_found');
      const settings = await loadSettings(tx);
      const list = await tx
        .select({ rider: riders, name: accounts.displayName })
        .from(riders)
        .innerJoin(accounts, eq(accounts.id, riders.accountId))
        .where(eq(accounts.status, 'active'));
      const ids = list.map((r) => r.rider.accountId);
      const [jobs, cash, declined] = await Promise.all([
        activeJobs(tx, ids),
        cashHeld(tx, ids),
        tx
          .select({ riderId: offers.riderId })
          .from(offers)
          .where(and(eq(offers.orderId, orderId), eq(offers.outcome, 'declined'))),
      ]);
      const shop = { lat: row.location.y, lng: row.location.x };
      return list
        .map(({ rider, name }): CandidateRider => {
          const reasons = riderIneligibility(
            {
              online: rider.online,
              paused: rider.paused,
              activeJobs: jobs.get(rider.accountId) ?? 0,
              cashHeldCents: cash.get(rider.accountId) ?? 0,
              declinedThisOrder: declined.some((d) => d.riderId === rider.accountId),
            },
            settings.riderCaps,
          );
          return {
            id: rider.accountId,
            name,
            vehicle: rider.vehicleType,
            plate: rider.plate,
            online: rider.online,
            activeJobs: jobs.get(rider.accountId) ?? 0,
            cashHeldCents: cash.get(rider.accountId) ?? 0,
            distanceMeters: rider.lastLocation
              ? haversineMeters(shop, { lat: rider.lastLocation.y, lng: rider.lastLocation.x })
              : null,
            lastSeenAt: rider.lastSeenAt?.toISOString() ?? null,
            eligible: reasons.length === 0,
            reasons,
          };
        })
        .sort(
          (a, b) =>
            Number(b.eligible) - Number(a.eligible) ||
            (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) ||
            a.activeJobs - b.activeJobs ||
            a.cashHeldCents - b.cashHeldCents,
        );
    });
  }

  private async takeLock(tx: Tx, orderId: string, auth: AuthContext, now: Date): Promise<Date> {
    const [lock] = await tx
      .select()
      .from(assignmentLocks)
      .where(eq(assignmentLocks.orderId, orderId))
      .for('update');
    if (lock && lock.accountId !== auth.accountId && lock.expiresAt > now) {
      const [holder] = await tx
        .select({ name: accounts.displayName })
        .from(accounts)
        .where(eq(accounts.id, lock.accountId));
      throw new ApiError('locked', {
        by: holder?.name ?? 'another dispatcher',
        expiresAt: lock.expiresAt.toISOString(),
      });
    }
    const expiresAt = new Date(now.getTime() + LOCK_MS);
    await tx
      .insert(assignmentLocks)
      .values({ orderId, accountId: auth.accountId, expiresAt })
      .onConflictDoUpdate({
        target: assignmentLocks.orderId,
        set: { accountId: auth.accountId, expiresAt },
      });
    return expiresAt;
  }

  /** Opening the assign flow takes a 30 s soft lock; a second dispatcher is refused (section 8 rule 6). */
  lock(auth: AuthContext, orderId: string): Promise<AssignmentLock> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
      if (!order) throw new ApiError('not_found');
      const expiresAt = await this.takeLock(tx, orderId, auth, this.clock());
      return { orderId, expiresAt: expiresAt.toISOString() };
    });
  }

  /** Offers the order to one eligible rider for the offer window (ADM-03, RID-03). */
  async offer(
    auth: AuthContext,
    orderId: string,
    riderId: string,
  ): Promise<{ offerId: string; expiresAt: string }> {
    const now = this.clock();
    const result = await withScope(this.db, PLATFORM, async (tx) => {
      await this.takeLock(tx, orderId, auth, now);
      const candidate = (await this.candidates(orderId)).find((c) => c.id === riderId);
      if (!candidate) throw new ApiError('not_found', { what: 'rider' });
      if (!candidate.eligible)
        throw new ApiError('rider_not_eligible', { reasons: candidate.reasons });

      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      const settings = await loadSettings(tx);
      const expiresAt = new Date(now.getTime() + settings.timers.offerSeconds * 1000);
      const [offer] = await tx
        .insert(offers)
        .values({
          orderId,
          riderId,
          offeredBy: auth.accountId,
          payoutCents: riderPayout(order!.deliveryFeeCents, settings.riderPay),
          sentAt: now,
          expiresAt,
        })
        .returning();
      await applyOrderEvent(
        tx,
        orderId,
        'offer_sent',
        { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId },
        {
          offerId: offer!.id,
          riderId,
        },
      );
      await tx.delete(assignmentLocks).where(eq(assignmentLocks.orderId, orderId));
      return { offerId: offer!.id, expiresAt, seconds: settings.timers.offerSeconds };
    });
    await this.jobs.sendAfter(
      DISPATCH_QUEUES.offerExpire,
      { offerId: result.offerId },
      result.seconds,
    );
    return { offerId: result.offerId, expiresAt: result.expiresAt.toISOString() };
  }

  /** Withdraws a pending offer so the order can be offered again (ADM-05). */
  cancelOffer(auth: AuthContext, offerId: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for('update');
      if (!offer?.orderId) throw new ApiError('not_found');
      if (offer.outcome !== 'pending')
        throw new ApiError('invalid_transition', { outcome: offer.outcome });
      await tx
        .update(offers)
        .set({ outcome: 'cancelled', respondedAt: this.clock() })
        .where(eq(offers.id, offerId));
      await applyOrderEvent(
        tx,
        offer.orderId,
        'offer_cancelled',
        { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId },
        { offerId },
      );
    });
  }
}
