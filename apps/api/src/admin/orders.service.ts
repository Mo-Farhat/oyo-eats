import { transition, type AdminOrderDetail, type OrderEvent } from '@oyo/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { accounts, offers, orderEvents, orders, supportCases } from '../db/schema.js';
import { applyOrderEvent, stateOf } from '../orders/order-events.js';
import type { OrdersService } from '../orders/orders.service.js';
import { latestSlip } from '../payments/bank-transfer.js';

const ROLE_NAME: Record<string, string> = {
  customer: 'Customer',
  restaurant_owner: 'Restaurant',
  restaurant_staff: 'Restaurant',
  dispatcher: 'Dispatch',
  owner: 'Owner',
  rider: 'Rider',
  system: 'System',
};

/** A02 and the basic A22 actions: one order with everything dispatch needs, cancel, failed. */
export class AdminOrdersService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
    private readonly orders: OrdersService,
  ) {}

  async get(auth: AuthContext, id: string): Promise<AdminOrderDetail> {
    const base = await this.orders.get(auth, id);
    return withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!order) throw new ApiError('not_found');
      const [customer] = await tx
        .select({ name: accounts.displayName, phone: accounts.phoneCiphertext })
        .from(accounts)
        .where(eq(accounts.id, order.customerId));
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, id))
        .orderBy(asc(orderEvents.occurredAt), asc(orderEvents.seq));
      const offerRows = await tx
        .select({
          riderName: accounts.displayName,
          outcome: offers.outcome,
          reason: offers.reason,
          payoutCents: offers.payoutCents,
          sentAt: offers.sentAt,
        })
        .from(offers)
        .innerJoin(accounts, eq(accounts.id, offers.riderId))
        .where(eq(offers.orderId, id))
        .orderBy(asc(offers.sentAt));
      const actorIds = [...new Set(events.map((e) => e.actorAccountId).filter((a) => a !== null))];
      const names = actorIds.length
        ? await tx
            .select({ id: accounts.id, name: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, actorIds))
        : [];
      const state = stateOf(order);
      const can = (event: OrderEvent) => transition(state, event, auth.role).ok;
      return {
        ...base,
        customer: {
          name: customer?.name ?? 'Customer',
          phone: customer?.phone ? decrypt(this.encryptionKey, customer.phone) : null,
        },
        events: events.map((e) => {
          const p = (e.payload ?? {}) as Record<string, unknown>;
          const who = names.find((n) => n.id === e.actorAccountId)?.name;
          return {
            type: e.type,
            at: e.occurredAt.toISOString(),
            actor: who
              ? `${who} (${ROLE_NAME[e.actorRole] ?? e.actorRole})`
              : (ROLE_NAME[e.actorRole] ?? e.actorRole),
            note:
              typeof p.reason === 'string'
                ? p.reason
                : typeof p.prepMinutes === 'number'
                  ? `${p.prepMinutes} min prep`
                  : null,
          };
        }),
        offers: offerRows.map((o) => ({ ...o, sentAt: o.sentAt.toISOString() })),
        canAdminCancel: can('cancelled_by_admin'),
        canMarkFailed: can('delivery_failed'),
      };
    });
  }

  private actor(auth: AuthContext) {
    return { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId };
  }

  /**
   * Cancel at any open stage, with a reason everyone can see in the timeline. Open offers are
   * withdrawn; a bank transfer already paid gets a refund case for the office.
   */
  async cancel(auth: AuthContext, id: string, reason: string): Promise<AdminOrderDetail> {
    await withScope(this.db, PLATFORM, async (tx) => {
      const order = await applyOrderEvent(tx, id, 'cancelled_by_admin', this.actor(auth), {
        reason,
      });
      await tx
        .update(offers)
        .set({ outcome: 'cancelled', respondedAt: new Date() })
        .where(and(eq(offers.orderId, id), eq(offers.outcome, 'pending')));
      const slip = order.paymentMethod === 'bank_transfer' ? await latestSlip(tx, id) : undefined;
      if (slip && (slip.status === 'pending' || slip.status === 'approved')) {
        await tx.insert(supportCases).values({
          orderId: id,
          tenantId: order.tenantId,
          reporterId: auth.accountId,
          type: 'refund_bank_transfer',
          description: `Cancelled by dispatch: ${reason}. Refund ${order.totalCents} cents by bank transfer.`,
        });
      }
    });
    return this.get(auth, id);
  }

  /** The rider couldn't hand over (no-show, wrong address): only once picked up. */
  async markFailed(auth: AuthContext, id: string, reason: string): Promise<AdminOrderDetail> {
    await withScope(this.db, PLATFORM, (tx) =>
      applyOrderEvent(tx, id, 'delivery_failed', this.actor(auth), { reason }),
    );
    return this.get(auth, id);
  }
}
