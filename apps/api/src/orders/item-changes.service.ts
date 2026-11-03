import {
  applyItemChange,
  canViewOrder,
  formatLkr,
  missingPart,
  substituteAllowed,
  type ItemChange,
  type ItemChangeChoice,
  type MarkItemUnavailableInput,
} from '@oyo/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  menuItems,
  modifierGroups,
  offers,
  orderEvents,
  orderItemChanges,
  orderItems,
  orders,
  payments,
  refunds,
  supportCases,
} from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { loadSettings } from '../settings/settings.js';
import { orderRefundableCents } from '../support/support.service.js';
import { applyOrderEvent, type EventActor, type OrderRow } from './order-events.js';
import { ORDER_QUEUES } from './queues.js';

type ChangeRow = typeof orderItemChanges.$inferSelect;
type ResolvedBy = 'customer' | 'timeout' | 'kitchen';

/** The item changes on these orders, oldest first, as the app shows them. */
export async function itemChangesFor(
  tx: Tx,
  orderIds: string[],
): Promise<Map<string, ItemChange[]>> {
  const map = new Map<string, ItemChange[]>(orderIds.map((id) => [id, []]));
  if (!orderIds.length) return map;
  const rows = await tx
    .select({ change: orderItemChanges, refundCents: refunds.amountCents })
    .from(orderItemChanges)
    .leftJoin(refunds, eq(refunds.id, orderItemChanges.refundId))
    .where(inArray(orderItemChanges.orderId, orderIds))
    .orderBy(asc(orderItemChanges.createdAt), asc(orderItemChanges.id));
  for (const { change: c, refundCents } of rows) {
    const missing = c.quantity - c.availableQuantity;
    map.get(c.orderId)?.push({
      id: c.id,
      orderItemId: c.orderItemId,
      name: c.name,
      quantity: c.quantity,
      availableQuantity: c.availableQuantity,
      missingCents: c.missingCents,
      substitute:
        c.substituteName && c.substituteUnitPriceCents !== null
          ? {
              name: c.substituteName,
              unitPriceCents: c.substituteUnitPriceCents,
              totalCents: c.substituteUnitPriceCents * missing,
            }
          : null,
      status: c.status as ItemChange['status'],
      resolvedBy: c.resolvedBy as ItemChange['resolvedBy'],
      respondBy: c.respondBy.toISOString(),
      refundCents: refundCents ?? 0,
      createdAt: c.createdAt.toISOString(),
    });
  }
  return map;
}

/** True while the customer still has to answer one (the kitchen can't mark the order ready). */
export async function hasPendingItemChange(tx: Tx, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: orderItemChanges.id })
    .from(orderItemChanges)
    .where(and(eq(orderItemChanges.orderId, orderId), eq(orderItemChanges.status, 'pending')))
    .limit(1);
  return !!row;
}

/**
 * RES-05: the kitchen can't make part of an order it accepted. With a substitute the customer
 * chooses (swap or remove) within the item-change timer, else it is removed; without one it is
 * removed at once. The order total changes in place: a cash order collects the new total, a
 * prepaid one gets the difference back by bank transfer through a refund case. If nothing is left
 * to make, the order is cancelled.
 *
 * Runs in platform scope (refunds, offers and settings need it) with an explicit tenant check on
 * the restaurant's side.
 */
export class ItemChangesService {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly clock: () => Date = () => new Date(),
  ) {
    jobs.define<{ changeId: string }>(ORDER_QUEUES.itemChangeTimeout, ({ changeId }) =>
      this.timeout(changeId),
    );
  }

  async markUnavailable(
    auth: AuthContext,
    orderId: string,
    input: MarkItemUnavailableInput,
  ): Promise<void> {
    const pending = await withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || order.tenantId !== auth.tenantId) throw new ApiError('not_found');
      if (order.status !== 'active' || order.kitchenStatus !== 'preparing')
        throw new ApiError('invalid_transition', { status: order.status });
      const [line] = await tx
        .select()
        .from(orderItems)
        .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, orderId)));
      if (!line) throw new ApiError('not_found');
      if (input.availableQuantity >= line.quantity)
        throw new ApiError('invalid_input', { field: 'availableQuantity' });
      const [open] = await tx
        .select({ id: orderItemChanges.id })
        .from(orderItemChanges)
        .where(
          and(eq(orderItemChanges.orderItemId, line.id), eq(orderItemChanges.status, 'pending')),
        );
      if (open) throw new ApiError('item_change_pending');

      let substitute: { id: string; name: string; priceCents: number } | null = null;
      if (input.substituteMenuItemId) {
        const [item] = await tx
          .select()
          .from(menuItems)
          .where(
            and(
              eq(menuItems.id, input.substituteMenuItemId),
              eq(menuItems.tenantId, order.tenantId),
            ),
          );
        const [required] = item
          ? await tx
              .select({ id: modifierGroups.id })
              .from(modifierGroups)
              .where(
                and(eq(modifierGroups.menuItemId, item.id), sql`${modifierGroups.minSelect} > 0`),
              )
              .limit(1)
          : [];
        // A substitute is ordered plain, so it can't be one that needs choices made.
        if (
          !item ||
          item.id === line.menuItemId ||
          item.soldOut ||
          item.archivedAt ||
          item.approvalStatus !== 'approved' ||
          required
        )
          throw new ApiError('invalid_input', { field: 'substituteMenuItemId' });
        if (!substituteAllowed(order.paymentMethod, line, input.availableQuantity, item.priceCents))
          throw new ApiError('substitute_costs_more');
        substitute = { id: item.id, name: item.name, priceCents: item.priceCents };
      }

      if (input.markSoldOut)
        await tx
          .update(menuItems)
          .set({ soldOut: true })
          .where(and(eq(menuItems.id, line.menuItemId), eq(menuItems.tenantId, order.tenantId)));

      const { timers } = await loadSettings(tx);
      const now = this.clock();
      const [change] = await tx
        .insert(orderItemChanges)
        .values({
          tenantId: order.tenantId,
          orderId,
          orderItemId: line.id,
          name: line.name,
          quantity: line.quantity,
          availableQuantity: input.availableQuantity,
          missingCents: missingPart(line, input.availableQuantity).cents,
          substituteMenuItemId: substitute?.id ?? null,
          substituteName: substitute?.name ?? null,
          substituteUnitPriceCents: substitute?.priceCents ?? null,
          respondBy: new Date(now.getTime() + timers.itemChangeSeconds * 1000),
          createdBy: auth.accountId,
        })
        .returning();
      const actor = { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId };
      await tx.insert(orderEvents).values({
        tenantId: order.tenantId,
        orderId,
        type: 'item_unavailable',
        actorAccountId: auth.accountId,
        actorRole: auth.role,
        deviceId: auth.deviceId,
        payload: {
          changeId: change!.id,
          name: line.name,
          quantity: line.quantity,
          availableQuantity: input.availableQuantity,
          substitute: substitute?.name ?? null,
        },
      });
      if (!substitute) {
        await this.resolve(tx, order, change!, 'remove', 'kitchen', actor);
        return null;
      }
      return { id: change!.id, seconds: timers.itemChangeSeconds };
    });
    if (pending)
      await this.jobs.sendAfter(
        ORDER_QUEUES.itemChangeTimeout,
        { changeId: pending.id },
        pending.seconds,
      );
  }

  /** The customer swaps or removes (C10). */
  respond(
    auth: AuthContext,
    orderId: string,
    changeId: string,
    choice: ItemChangeChoice,
  ): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || auth.role !== 'customer' || !canViewOrder(auth, order))
        throw new ApiError('not_found');
      const [change] = await tx
        .select()
        .from(orderItemChanges)
        .where(and(eq(orderItemChanges.id, changeId), eq(orderItemChanges.orderId, orderId)));
      if (!change) throw new ApiError('not_found');
      if (change.status !== 'pending')
        throw new ApiError('invalid_transition', { status: change.status });
      if (choice === 'substitute' && change.substituteUnitPriceCents === null)
        throw new ApiError('invalid_input', { field: 'choice' });
      await this.resolve(tx, order, change, choice, 'customer', {
        role: 'customer',
        accountId: auth.accountId,
        deviceId: auth.deviceId,
      });
    });
  }

  /** Timer: no answer in time, so the missing part is removed. */
  async timeout(changeId: string): Promise<void> {
    await withScope(this.db, PLATFORM, async (tx) => {
      const [first] = await tx
        .select({ orderId: orderItemChanges.orderId })
        .from(orderItemChanges)
        .where(eq(orderItemChanges.id, changeId));
      if (!first) return;
      // Order row first, as every other path does, so the two can't deadlock.
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, first.orderId))
        .for('update');
      const [change] = await tx
        .select()
        .from(orderItemChanges)
        .where(eq(orderItemChanges.id, changeId));
      if (!order || change?.status !== 'pending') return;
      await this.resolve(tx, order, change, 'remove', 'timeout', {
        role: 'system',
        accountId: null,
      });
    });
  }

  /** Applies the choice to the lines and totals. The caller holds the order row lock. */
  private async resolve(
    tx: Tx,
    order: OrderRow,
    change: ChangeRow,
    choice: ItemChangeChoice,
    by: ResolvedBy,
    actor: EventActor,
  ): Promise<void> {
    const now = this.clock();
    const done = { resolvedBy: by, resolvedAt: now };
    // The order may have closed meanwhile (the office cancelled it): nothing left to change.
    if (order.status !== 'active') {
      await tx
        .update(orderItemChanges)
        .set({ ...done, status: 'removed' })
        .where(eq(orderItemChanges.id, change.id));
      return;
    }
    const [line] = change.orderItemId
      ? await tx.select().from(orderItems).where(eq(orderItems.id, change.orderItemId))
      : [];
    const [{ count: lineCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const result = line
      ? applyItemChange(line, change.availableQuantity, choice, change.substituteUnitPriceCents)
      : null;
    const status = choice === 'substitute' ? 'substituted' : 'removed';
    // Removing the only thing left: cancel with the lines kept, so the order still shows them.
    if (line && result && !result.keep && !result.substitute && lineCount === 1) {
      await tx
        .update(orderItemChanges)
        .set({ ...done, status })
        .where(eq(orderItemChanges.id, change.id));
      await this.writeEvent(tx, order, actor, {
        changeId: change.id,
        choice,
        by,
        name: change.name,
        substitute: null,
        totalCents: order.totalCents,
      });
      await this.cancelEmpty(tx, order, change);
      return;
    }
    if (line && result) {
      if (result.keep)
        await tx
          .update(orderItems)
          .set({ quantity: result.keep.quantity, lineTotalCents: result.keep.lineTotalCents })
          .where(eq(orderItems.id, line.id));
      else await tx.delete(orderItems).where(eq(orderItems.id, line.id));
      if (result.substitute)
        await tx.insert(orderItems).values({
          tenantId: order.tenantId,
          orderId: order.id,
          menuItemId: change.substituteMenuItemId!,
          name: change.substituteName!,
          unitPriceCents: result.substitute.unitPriceCents,
          modifiers: [],
          quantity: result.substitute.quantity,
          lineTotalCents: result.substitute.lineTotalCents,
          note: `Instead of ${line.name}`,
        });
    }
    await tx
      .update(orderItemChanges)
      .set({ ...done, status })
      .where(eq(orderItemChanges.id, change.id));

    const [{ itemsCents } = { itemsCents: 0 }] = await tx
      .select({
        itemsCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const event = {
      changeId: change.id,
      choice,
      by,
      name: change.name,
      substitute: choice === 'substitute' ? change.substituteName : null,
    };

    const totalCents = itemsCents + order.deliveryFeeCents + order.restaurantFeeCents;
    await tx.update(orders).set({ itemsCents, totalCents }).where(eq(orders.id, order.id));
    let refundCents = 0;
    if (order.paymentMethod !== 'cod') {
      const [payment] = await tx
        .select({ amountCents: payments.amountCents })
        .from(payments)
        .where(eq(payments.orderId, order.id));
      const [{ sum } = { sum: 0 }] = await tx
        .select({ sum: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::int` })
        .from(refunds)
        .where(eq(refunds.orderId, order.id));
      // Paid less refunds so far, against the new total: the rest goes back to the customer.
      refundCents = (payment?.amountCents ?? order.totalCents) - sum - totalCents;
      if (refundCents > 0) {
        const caseId = await this.refundCase(tx, order, change, refundCents);
        const [refund] = await tx
          .insert(refunds)
          .values({
            orderId: order.id,
            tenantId: order.tenantId,
            caseId,
            customerId: order.customerId,
            riderId: order.riderId,
            amountCents: refundCents,
            reasonCode: 'item_unavailable',
            attribution: 'restaurant',
            orderAdjusted: true,
            note: `${change.name}: ${choice === 'substitute' ? `swapped for ${change.substituteName}` : 'removed'}`,
            issuedBy: change.createdBy,
          })
          .returning({ id: refunds.id });
        await tx
          .update(orderItemChanges)
          .set({ refundId: refund!.id })
          .where(eq(orderItemChanges.id, change.id));
      } else refundCents = 0;
    }
    await this.writeEvent(tx, order, actor, { ...event, totalCents, refundCents });
  }

  private async writeEvent(
    tx: Tx,
    order: OrderRow,
    actor: EventActor,
    payload: Record<string, unknown>,
  ) {
    await tx.insert(orderEvents).values({
      tenantId: order.tenantId,
      orderId: order.id,
      type: 'item_change_resolved',
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      deviceId: actor.deviceId ?? null,
      payload,
    });
  }

  /** One open bank-transfer refund case per order collects the item-change refunds. */
  private async refundCase(
    tx: Tx,
    order: OrderRow,
    change: ChangeRow,
    cents: number,
  ): Promise<string> {
    const line = `${change.name} unavailable: refund ${formatLkr(cents)} by bank transfer.`;
    const [open] = await tx
      .select({ id: supportCases.id, description: supportCases.description })
      .from(supportCases)
      .where(
        and(
          eq(supportCases.orderId, order.id),
          eq(supportCases.type, 'refund_bank_transfer'),
          sql`${supportCases.status} <> 'resolved'`,
        ),
      );
    if (open) {
      await tx
        .update(supportCases)
        .set({ description: [open.description, line].filter(Boolean).join('\n') })
        .where(eq(supportCases.id, open.id));
      return open.id;
    }
    const [created] = await tx
      .insert(supportCases)
      .values({
        orderId: order.id,
        tenantId: order.tenantId,
        reporterId: change.createdBy,
        type: 'refund_bank_transfer',
        description: line,
      })
      .returning({ id: supportCases.id });
    return created!.id;
  }

  /** Nothing left to make: cancel, withdraw offers, and hand a paid transfer to the office. */
  private async cancelEmpty(tx: Tx, order: OrderRow, change: ChangeRow) {
    await applyOrderEvent(
      tx,
      order.id,
      'cancelled_items_unavailable',
      { role: 'system', accountId: null },
      { reason: `${change.name} unavailable` },
    );
    await tx
      .update(offers)
      .set({ outcome: 'cancelled', respondedAt: this.clock() })
      .where(and(eq(offers.orderId, order.id), eq(offers.outcome, 'pending')));
    if (order.paymentMethod === 'cod') return;
    const cents = await orderRefundableCents(tx, order);
    if (cents > 0)
      await tx.insert(supportCases).values({
        orderId: order.id,
        tenantId: order.tenantId,
        reporterId: change.createdBy,
        type: 'refund_bank_transfer',
        description: `Cancelled: nothing left to make. Refund ${formatLkr(cents)} by bank transfer.`,
      });
  }
}
