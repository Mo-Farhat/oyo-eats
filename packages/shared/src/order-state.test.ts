import { describe, expect, it } from 'vitest';
import {
  initialOrderState,
  isTerminal,
  ORDER_EVENTS,
  PAYMENT_METHODS,
  transition,
  type Actor,
  type OrderEvent,
  type OrderState,
  type PaymentMethod,
} from './order-state.js';
import { ROLES } from './roles.js';

/*
 * The spec, written out independently of the implementation. A state key is
 * "status|kitchen|delivery" with "-" for null. Every (state, event) pair not listed here must be
 * rejected as invalid_transition, and every listed one must reject actors outside EXPECTED_ACTORS.
 */
type Key = string;
interface Expected {
  from: Key;
  to: Key;
  methods?: readonly PaymentMethod[];
}

const KITCHEN = ['preparing', 'ready'] as const;
const DELIVERY = ['unassigned', 'offered', 'assigned'] as const;
const ADMIN: Actor[] = ['dispatcher', 'owner'];
const RESTAURANT: Actor[] = ['restaurant_staff', 'restaurant_owner'];

const activeKeys = KITCHEN.flatMap((k) => DELIVERY.map((d) => `active|${k}|${d}`));
const deliveryMove = (from: string, to: string): Expected[] =>
  KITCHEN.map((k) => ({ from: `active|${k}|${from}`, to: `active|${k}|${to}` }));

const EXPECTED: Record<OrderEvent, Expected[]> = {
  payment_confirmed: [
    { from: 'awaiting_payment|-|-', to: 'awaiting_restaurant|-|-', methods: ['card'] },
  ],
  slip_approved: [
    { from: 'awaiting_payment|-|-', to: 'awaiting_restaurant|-|-', methods: ['bank_transfer'] },
  ],
  payment_expired: [{ from: 'awaiting_payment|-|-', to: 'cancelled|-|-' }],
  restaurant_accepted: [{ from: 'awaiting_restaurant|-|-', to: 'active|preparing|unassigned' }],
  restaurant_rejected: [{ from: 'awaiting_restaurant|-|-', to: 'rejected|-|-' }],
  restaurant_timed_out: [{ from: 'awaiting_restaurant|-|-', to: 'rejected|-|-' }],
  marked_ready: DELIVERY.map((d) => ({ from: `active|preparing|${d}`, to: `active|ready|${d}` })),
  offer_sent: deliveryMove('unassigned', 'offered'),
  offer_accepted: deliveryMove('offered', 'assigned'),
  offer_declined: deliveryMove('offered', 'unassigned'),
  offer_expired: deliveryMove('offered', 'unassigned'),
  offer_cancelled: deliveryMove('offered', 'unassigned'),
  assignment_cancelled: deliveryMove('assigned', 'unassigned'),
  picked_up: [{ from: 'active|ready|assigned', to: 'picked_up|ready|assigned' }],
  delivered: [{ from: 'picked_up|ready|assigned', to: 'delivered|ready|assigned' }],
  cancelled_by_customer: [
    { from: 'awaiting_payment|-|-', to: 'cancelled|-|-' },
    { from: 'awaiting_restaurant|-|-', to: 'cancelled|-|-' },
  ],
  cancelled_by_admin: [
    'awaiting_payment|-|-',
    'awaiting_restaurant|-|-',
    ...activeKeys,
    'picked_up|ready|assigned',
  ].map((from) => ({ from, to: `cancelled|${from.split('|').slice(1).join('|')}` })),
  delivery_failed: [{ from: 'picked_up|ready|assigned', to: 'failed|ready|assigned' }],
};

const EXPECTED_ACTORS: Record<OrderEvent, Actor[]> = {
  payment_confirmed: ['system'],
  slip_approved: ADMIN,
  payment_expired: ['system'],
  restaurant_accepted: RESTAURANT,
  restaurant_rejected: RESTAURANT,
  restaurant_timed_out: ['system'],
  marked_ready: RESTAURANT,
  offer_sent: ADMIN,
  offer_accepted: ['rider'],
  offer_declined: ['rider'],
  offer_expired: ['system'],
  offer_cancelled: ADMIN,
  assignment_cancelled: ADMIN,
  picked_up: ['rider'],
  delivered: ['rider'],
  cancelled_by_customer: ['customer'],
  cancelled_by_admin: ADMIN,
  delivery_failed: ADMIN,
};

const ACTORS: Actor[] = [...ROLES, 'system'];
const key = (s: OrderState): Key => `${s.status}|${s.kitchen ?? '-'}|${s.delivery ?? '-'}`;

/** Every state reachable from an initial state, found by trying every event with every actor. */
function reachableStates(): OrderState[] {
  const seen = new Map<string, OrderState>();
  const queue = PAYMENT_METHODS.map(initialOrderState);
  while (queue.length > 0) {
    const state = queue.shift()!;
    const id = `${state.paymentMethod}:${key(state)}`;
    if (seen.has(id)) continue;
    seen.set(id, state);
    for (const event of ORDER_EVENTS) {
      for (const actor of ACTORS) {
        const result = transition(state, event, actor);
        if (result.ok) queue.push(result.state);
      }
    }
  }
  return [...seen.values()];
}

const states = reachableStates();

function expectedFor(state: OrderState, event: OrderEvent): Expected | undefined {
  return EXPECTED[event].find(
    (e) => e.from === key(state) && (!e.methods || e.methods.includes(state.paymentMethod)),
  );
}

describe('initialOrderState', () => {
  it('sends COD straight to the restaurant and holds prepaid methods for payment', () => {
    expect(key(initialOrderState('cod'))).toBe('awaiting_restaurant|-|-');
    expect(key(initialOrderState('bank_transfer'))).toBe('awaiting_payment|-|-');
    expect(key(initialOrderState('card'))).toBe('awaiting_payment|-|-');
  });
});

describe('transition, exhaustively', () => {
  it('reaches every from-state in the spec', () => {
    const reachedKeys = new Set(states.map(key));
    for (const expectations of Object.values(EXPECTED)) {
      for (const { from } of expectations) expect(reachedKeys).toContain(from);
    }
  });

  for (const state of states) {
    for (const event of ORDER_EVENTS) {
      const expected = expectedFor(state, event);
      const label = `${state.paymentMethod} ${key(state)} + ${event}`;

      if (!expected) {
        it(`${label}: invalid for every actor`, () => {
          for (const actor of ACTORS) {
            expect(transition(state, event, actor)).toEqual({
              ok: false,
              error: 'invalid_transition',
            });
          }
        });
        continue;
      }

      it(`${label} -> ${expected.to}`, () => {
        for (const actor of ACTORS) {
          const result = transition(state, event, actor);
          if (EXPECTED_ACTORS[event].includes(actor)) {
            expect(result.ok && key(result.state)).toBe(expected.to);
            expect(result.ok && result.state.paymentMethod).toBe(state.paymentMethod);
          } else {
            expect(result).toEqual({ ok: false, error: 'forbidden_actor' });
          }
        }
      });
    }
  }
});

describe('lifecycle rules', () => {
  const run = (method: PaymentMethod, steps: [OrderEvent, Actor][]): OrderState => {
    let state = initialOrderState(method);
    for (const [event, actor] of steps) {
      const result = transition(state, event, actor);
      if (!result.ok) throw new Error(`${event} by ${actor} failed: ${result.error}`);
      state = result.state;
    }
    return state;
  };

  it('runs a COD order end to end with a declined offer on the way', () => {
    const state = run('cod', [
      ['restaurant_accepted', 'restaurant_staff'],
      ['offer_sent', 'dispatcher'],
      ['offer_declined', 'rider'],
      ['offer_sent', 'dispatcher'],
      ['offer_accepted', 'rider'],
      ['marked_ready', 'restaurant_staff'],
      ['picked_up', 'rider'],
      ['delivered', 'rider'],
    ]);
    expect(key(state)).toBe('delivered|ready|assigned');
    expect(isTerminal(state)).toBe(true);
  });

  it('holds a bank-transfer order from the kitchen until the slip is approved', () => {
    const held = initialOrderState('bank_transfer');
    expect(transition(held, 'restaurant_accepted', 'restaurant_staff')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(key(run('bank_transfer', [['slip_approved', 'dispatcher']]))).toBe(
      'awaiting_restaurant|-|-',
    );
  });

  it('needs both ready and assigned for pickup, in either order', () => {
    const assignedFirst = run('cod', [
      ['restaurant_accepted', 'restaurant_staff'],
      ['offer_sent', 'dispatcher'],
      ['offer_accepted', 'rider'],
    ]);
    expect(transition(assignedFirst, 'picked_up', 'rider')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });

    const readyFirst = run('cod', [
      ['restaurant_accepted', 'restaurant_staff'],
      ['marked_ready', 'restaurant_staff'],
    ]);
    expect(transition(readyFirst, 'picked_up', 'rider')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
  });

  it('stops customer self-cancel once the restaurant accepts', () => {
    const accepted = run('cod', [['restaurant_accepted', 'restaurant_owner']]);
    expect(transition(accepted, 'cancelled_by_customer', 'customer')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(transition(accepted, 'cancelled_by_admin', 'dispatcher').ok).toBe(true);
  });

  it('accepts nothing once an order is terminal', () => {
    for (const state of states.filter(isTerminal)) {
      for (const event of ORDER_EVENTS) {
        for (const actor of ACTORS) expect(transition(state, event, actor).ok).toBe(false);
      }
    }
  });
});

describe('customerStage', () => {
  it('maps every state to the customer timeline', async () => {
    const { customerStage } = await import('./order-state.js');
    const s = (
      status: OrderState['status'],
      kitchen: OrderState['kitchen'] = null,
      delivery: OrderState['delivery'] = null,
    ) => customerStage({ status, kitchen, delivery });
    expect(s('awaiting_payment')).toBe('placed');
    expect(s('awaiting_restaurant')).toBe('confirmed');
    expect(s('active', 'preparing', 'unassigned')).toBe('preparing');
    expect(s('active', 'preparing', 'offered')).toBe('preparing');
    expect(s('active', 'ready', 'unassigned')).toBe('ready');
    expect(s('active', 'preparing', 'assigned')).toBe('rider_assigned');
    expect(s('active', 'ready', 'assigned')).toBe('rider_assigned');
    expect(s('picked_up', 'ready', 'assigned')).toBe('picked_up');
    expect(s('delivered', 'ready', 'assigned')).toBe('delivered');
    for (const exit of ['rejected', 'cancelled', 'failed'] as const) expect(s(exit)).toBeNull();
  });
});
