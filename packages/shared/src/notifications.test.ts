import { describe, expect, it } from 'vitest';
import { orderNotifications, type OrderEventContext } from './notifications.js';
import { ORDER_EVENTS } from './order-state.js';

const ctx = (type: string, over: Partial<OrderEventContext> = {}): OrderEventContext => ({
  type,
  reference: 'ABC123',
  restaurantName: 'Hill Top Kottu House',
  paymentMethod: 'cod',
  riderName: 'Kasun Perera',
  prepMinutes: 15,
  payload: {},
  prepaid: false,
  ...over,
});
const who = (type: string, over: Partial<OrderEventContext> = {}) =>
  orderNotifications(ctx(type, over)).map((n) => n.audience);

describe('orderNotifications', () => {
  it('follows the PRD table for the main moments', () => {
    expect(who('placed')).toEqual(['restaurant']);
    expect(who('placed', { paymentMethod: 'bank_transfer' })).toEqual([]);
    expect(who('slip_uploaded')).toEqual(['dispatch']);
    expect(who('slip_approved')).toEqual(['customer', 'restaurant']);
    expect(who('restaurant_accepted')).toEqual(['customer']);
    expect(who('offer_sent')).toEqual(['rider']);
    expect(who('offer_accepted')).toEqual(['customer', 'restaurant']);
    expect(who('offer_declined')).toEqual(['dispatch']);
    expect(who('marked_ready')).toEqual(['customer', 'rider']);
    expect(who('marked_ready', { riderName: null })).toEqual(['customer']);
    expect(who('picked_up')).toEqual(['customer']);
    expect(who('delivered')).toEqual(['customer', 'restaurant']);
    expect(who('cancelled_by_admin')).toEqual(['customer', 'restaurant', 'rider']);
  });

  it('marks the moments that must not be missed as critical (NOT-01)', () => {
    const critical = ORDER_EVENTS.concat(['placed'] as never).flatMap((t) =>
      orderNotifications(ctx(t))
        .filter((n) => n.critical)
        .map((n) => `${t}:${n.audience}`),
    );
    expect(critical.sort()).toEqual(
      [
        'offer_accepted:customer',
        'offer_sent:rider',
        'placed:restaurant',
        'slip_approved:restaurant',
      ].sort(),
    );
  });

  it('says a prepaid customer will be refunded, and uses only first names', () => {
    expect(orderNotifications(ctx('restaurant_rejected', { prepaid: true }))[0]!.body).toContain(
      'refunded',
    );
    expect(orderNotifications(ctx('restaurant_rejected'))[0]!.body).toContain(
      'Nothing was charged',
    );
    expect(orderNotifications(ctx('offer_accepted'))[0]!.title).toBe('Kasun is on your order');
  });

  it('never puts a phone number or an address in the text (NOT-05)', () => {
    const phoneLike = /\+?\d[\d\s-]{8,}/;
    for (const t of [...ORDER_EVENTS, 'placed', 'slip_uploaded', 'slip_rejected']) {
      for (const n of orderNotifications(ctx(t, { payload: { reason: 'Customer asked' } }))) {
        expect(`${n.title} ${n.body}`).not.toMatch(phoneLike);
      }
    }
  });

  it('asks the customer about an unavailable item and tells the kitchen the answer (RES-05)', () => {
    const offered = orderNotifications(
      ctx('item_unavailable', { payload: { name: 'Chicken Kottu', substitute: 'Egg Kottu' } }),
    );
    expect(offered).toEqual([
      expect.objectContaining({
        audience: 'customer',
        title: 'Hill Top Kottu House is out of Chicken Kottu',
        critical: true,
      }),
    ]);
    const removed = orderNotifications(
      ctx('item_unavailable', { payload: { name: 'Chicken Kottu' } }),
    )[0]!;
    expect(removed.audience).toBe('customer');
    expect(removed.critical).toBeFalsy();
    const answered = orderNotifications(
      ctx('item_change_resolved', {
        payload: {
          name: 'Chicken Kottu',
          substitute: 'Egg Kottu',
          choice: 'substitute',
          by: 'customer',
        },
      }),
    );
    expect(answered).toEqual([
      expect.objectContaining({ audience: 'restaurant', title: '#ABC123: make Egg Kottu instead' }),
    ]);
    expect(
      orderNotifications(
        ctx('item_change_resolved', {
          payload: { name: 'Chicken Kottu', choice: 'remove', by: 'timeout' },
        }),
      )[0]!.body,
    ).toContain('didn’t answer');
    expect(who('item_change_resolved', { payload: { by: 'kitchen' } })).toEqual([]);
    expect(who('cancelled_items_unavailable')).toEqual(['customer', 'restaurant', 'rider']);
  });
});
