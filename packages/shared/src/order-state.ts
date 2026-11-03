import type { Role } from './roles.js';

/*
 * Order lifecycle (PRD section 8). After the restaurant accepts, the order runs on two tracks:
 *   kitchen:  preparing -> ready
 *   delivery: unassigned -> offered -> assigned  (offers can bounce back to unassigned)
 * The tracks meet at pickup, which needs kitchen = ready and delivery = assigned.
 * Exit states: rejected (restaurant rejected or timed out), cancelled, failed (after pickup).
 *
 * This checks the state and the actor's role only. The API also checks that the actor owns
 * the order, job or restaurant (SEC-10), records every transition as an order event, and runs
 * the timers that send the system events.
 */

export const PAYMENT_METHODS = ['cod', 'bank_transfer', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = [
  'awaiting_payment',
  'awaiting_restaurant',
  'active',
  'picked_up',
  'delivered',
  'rejected',
  'cancelled',
  'failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const KITCHEN_STATUSES = ['preparing', 'ready'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export const DELIVERY_STATUSES = ['unassigned', 'offered', 'assigned'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface OrderState {
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  /** Null until the restaurant accepts. */
  kitchen: KitchenStatus | null;
  /** Null until the restaurant accepts. */
  delivery: DeliveryStatus | null;
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'rejected',
  'cancelled',
  'failed',
];

export const ORDER_EVENTS = [
  'payment_confirmed',
  'slip_approved',
  'payment_expired',
  'restaurant_accepted',
  'restaurant_rejected',
  'restaurant_timed_out',
  'marked_ready',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'offer_expired',
  'offer_cancelled',
  'assignment_cancelled',
  'picked_up',
  'delivered',
  'cancelled_by_customer',
  'cancelled_by_admin',
  'cancelled_items_unavailable',
  'delivery_failed',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export type Actor = Role | 'system';

interface Rule {
  actors: readonly Actor[];
  /** Whether the event applies in this state. */
  from: (s: OrderState) => boolean;
  to: (s: OrderState) => OrderState;
}

const ADMIN: readonly Actor[] = ['dispatcher', 'owner'];
const RESTAURANT: readonly Actor[] = ['restaurant_staff', 'restaurant_owner'];

const isActive = (s: OrderState) => s.status === 'active';

const RULES: Record<OrderEvent, Rule> = {
  // A card order becomes payable when the gateway's verified webhook arrives.
  payment_confirmed: {
    actors: ['system'],
    from: (s) => s.status === 'awaiting_payment' && s.paymentMethod === 'card',
    to: (s) => ({ ...s, status: 'awaiting_restaurant' }),
  },
  // A bank-transfer order is held from the kitchen until an admin approves the slip.
  slip_approved: {
    actors: ADMIN,
    from: (s) => s.status === 'awaiting_payment' && s.paymentMethod === 'bank_transfer',
    to: (s) => ({ ...s, status: 'awaiting_restaurant' }),
  },
  // Slip window (or card payment) ran out: auto-cancel, no charge.
  payment_expired: {
    actors: ['system'],
    from: (s) => s.status === 'awaiting_payment',
    to: (s) => ({ ...s, status: 'cancelled' }),
  },
  restaurant_accepted: {
    actors: RESTAURANT,
    from: (s) => s.status === 'awaiting_restaurant',
    to: (s) => ({ ...s, status: 'active', kitchen: 'preparing', delivery: 'unassigned' }),
  },
  restaurant_rejected: {
    actors: RESTAURANT,
    from: (s) => s.status === 'awaiting_restaurant',
    to: (s) => ({ ...s, status: 'rejected' }),
  },
  restaurant_timed_out: {
    actors: ['system'],
    from: (s) => s.status === 'awaiting_restaurant',
    to: (s) => ({ ...s, status: 'rejected' }),
  },
  marked_ready: {
    actors: RESTAURANT,
    from: (s) => isActive(s) && s.kitchen === 'preparing',
    to: (s) => ({ ...s, kitchen: 'ready' }),
  },
  offer_sent: {
    actors: ADMIN,
    from: (s) => isActive(s) && s.delivery === 'unassigned',
    to: (s) => ({ ...s, delivery: 'offered' }),
  },
  offer_accepted: {
    actors: ['rider'],
    from: (s) => isActive(s) && s.delivery === 'offered',
    to: (s) => ({ ...s, delivery: 'assigned' }),
  },
  offer_declined: {
    actors: ['rider'],
    from: (s) => isActive(s) && s.delivery === 'offered',
    to: (s) => ({ ...s, delivery: 'unassigned' }),
  },
  offer_expired: {
    actors: ['system'],
    from: (s) => isActive(s) && s.delivery === 'offered',
    to: (s) => ({ ...s, delivery: 'unassigned' }),
  },
  offer_cancelled: {
    actors: ADMIN,
    from: (s) => isActive(s) && s.delivery === 'offered',
    to: (s) => ({ ...s, delivery: 'unassigned' }),
  },
  // Before pickup only. Swapping riders after pickup keeps the status and is logged with a reason.
  assignment_cancelled: {
    actors: ADMIN,
    from: (s) => isActive(s) && s.delivery === 'assigned',
    to: (s) => ({ ...s, delivery: 'unassigned' }),
  },
  picked_up: {
    actors: ['rider'],
    from: (s) => isActive(s) && s.kitchen === 'ready' && s.delivery === 'assigned',
    to: (s) => ({ ...s, status: 'picked_up' }),
  },
  delivered: {
    actors: ['rider'],
    from: (s) => s.status === 'picked_up',
    to: (s) => ({ ...s, status: 'delivered' }),
  },
  // Customers cancel freely until the restaurant accepts (CUS-14); after that it goes through support.
  cancelled_by_customer: {
    actors: ['customer'],
    from: (s) => s.status === 'awaiting_payment' || s.status === 'awaiting_restaurant',
    to: (s) => ({ ...s, status: 'cancelled' }),
  },
  cancelled_by_admin: {
    actors: ADMIN,
    from: (s) => !TERMINAL_STATUSES.includes(s.status),
    to: (s) => ({ ...s, status: 'cancelled' }),
  },
  // RES-05: every item turned out unavailable and the customer's answer left nothing to cook.
  cancelled_items_unavailable: {
    actors: ['system'],
    from: (s) => isActive(s) && s.kitchen === 'preparing',
    to: (s) => ({ ...s, status: 'cancelled' }),
  },
  // Delivery failed or no-show at the door.
  delivery_failed: {
    actors: ADMIN,
    from: (s) => s.status === 'picked_up',
    to: (s) => ({ ...s, status: 'failed' }),
  },
};

export function initialOrderState(paymentMethod: PaymentMethod): OrderState {
  return {
    paymentMethod,
    status: paymentMethod === 'cod' ? 'awaiting_restaurant' : 'awaiting_payment',
    kitchen: null,
    delivery: null,
  };
}

export type TransitionResult =
  | { ok: true; state: OrderState }
  /** invalid_transition: the event does not apply in this state (HTTP 409). */
  /** forbidden_actor: it applies, but not for this role (HTTP 403). */
  | { ok: false; error: 'invalid_transition' | 'forbidden_actor' };

export function transition(state: OrderState, event: OrderEvent, actor: Actor): TransitionResult {
  const rule = RULES[event];
  if (!rule.from(state)) return { ok: false, error: 'invalid_transition' };
  if (!rule.actors.includes(actor)) return { ok: false, error: 'forbidden_actor' };
  return { ok: true, state: rule.to(state) };
}

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATUSES.includes(state.status);
}

/** The steps a customer sees on the tracking timeline (CUS-11). */
export const CUSTOMER_STAGES = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'rider_assigned',
  'picked_up',
  'delivered',
] as const;
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

/**
 * Where the order is on the customer's timeline. "confirmed" means payable and with the
 * restaurant; a rider can be assigned before the food is ready, so assignment wins over the
 * kitchen state. Exit states return null (the screen shows the exit instead).
 */
export function customerStage(
  state: Pick<OrderState, 'status' | 'kitchen' | 'delivery'>,
): CustomerStage | null {
  switch (state.status) {
    case 'awaiting_payment':
      return 'placed';
    case 'awaiting_restaurant':
      return 'confirmed';
    case 'active':
      if (state.delivery === 'assigned') return 'rider_assigned';
      return state.kitchen === 'ready' ? 'ready' : 'preparing';
    case 'picked_up':
      return 'picked_up';
    case 'delivered':
      return 'delivered';
    default:
      return null;
  }
}
