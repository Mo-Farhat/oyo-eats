import { describe, expect, it } from 'vitest';
import { roomsForAccount, route } from './rooms.js';

describe('live rooms', () => {
  it('puts each role in its own rooms', () => {
    expect(roomsForAccount({ accountId: 'c', role: 'customer', tenantId: null })).toEqual([
      'account:c',
    ]);
    expect(roomsForAccount({ accountId: 'd', role: 'dispatcher', tenantId: null })).toEqual([
      'account:d',
      'dispatch',
    ]);
    expect(roomsForAccount({ accountId: 'o', role: 'owner', tenantId: null })).toEqual([
      'account:o',
      'dispatch',
      'menu-review',
    ]);
    expect(roomsForAccount({ accountId: 'k', role: 'restaurant_staff', tenantId: 't' })).toEqual([
      'account:k',
      'tenant:t',
    ]);
    expect(roomsForAccount({ accountId: 'r', role: 'rider', tenantId: null })).toEqual([
      'account:r',
    ]);
  });

  it('sends order changes to the parties and the office, with ids only', () => {
    const r = route({
      kind: 'order',
      orderId: 'o1',
      type: 'offer_sent',
      tenantId: 't1',
      customerId: 'c1',
      riderIds: ['r1'],
    });
    expect(r.rooms).toEqual(['dispatch', 'tenant:t1', 'account:c1', 'account:r1']);
    expect(r.message).toEqual({ kind: 'order', orderId: 'o1', type: 'offer_sent' });
    expect(route({ kind: 'menu', tenantId: 't1' })).toEqual({
      rooms: ['tenant:t1', 'menu-review'],
      message: { kind: 'menu' },
    });
  });
});
