import { isTerminal, transition, type Actor, type OrderEvent, type OrderState } from '@oyo/shared';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import type { Tx } from '../db/client.js';
import { orderEvents, orders } from '../db/schema.js';

export type OrderRow = typeof orders.$inferSelect;

export interface EventActor {
  role: Actor;
  /** Null for system timers. */
  accountId: string | null;
  deviceId?: string | null;
}

export function stateOf(row: OrderRow): OrderState {
  return {
    paymentMethod: row.paymentMethod,
    status: row.status,
    kitchen: row.kitchenStatus,
    delivery: row.deliveryStatus,
  };
}

/**
 * The only way an order changes state: locks the row, applies the shared state machine
 * (packages/shared/src/order-state.ts), saves the new state and appends an order event.
 * Must run inside the caller's transaction. Object-level checks (is this the caller's order?)
 * are the caller's job.
 */
export async function applyOrderEvent(
  tx: Tx,
  orderId: string,
  event: OrderEvent,
  actor: EventActor,
  payload: Record<string, unknown> = {},
): Promise<OrderRow> {
  const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!row) throw new ApiError('not_found');

  const result = transition(stateOf(row), event, actor.role);
  if (!result.ok) {
    throw new ApiError(result.error === 'forbidden_actor' ? 'forbidden' : 'invalid_transition', {
      status: row.status,
      event,
    });
  }

  const next = result.state;
  const [updated] = await tx
    .update(orders)
    .set({
      status: next.status,
      kitchenStatus: next.kitchen,
      deliveryStatus: next.delivery,
      version: sql`${orders.version} + 1`,
      ...(isTerminal(next) ? { closedAt: new Date() } : {}),
    })
    .where(eq(orders.id, orderId))
    .returning();

  await tx.insert(orderEvents).values({
    tenantId: row.tenantId,
    orderId,
    type: event,
    actorAccountId: actor.accountId,
    actorRole: actor.role,
    deviceId: actor.deviceId ?? null,
    payload,
  });
  return updated!;
}
