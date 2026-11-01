import { describe, expect, it } from 'vitest';
import {
  canSeeCustomerContact,
  canSeeRiderContact,
  canViewOrder,
  type Caller,
  type OrderParties,
} from './access.js';
import { ORDER_STATUSES, type OrderStatus } from './order-state.js';

const order: OrderParties = { customerId: 'c1', tenantId: 't1', riderId: 'r1', status: 'active' };
const caller = (role: Caller['role'], accountId = 'x', tenantId: string | null = null): Caller => ({
  role,
  accountId,
  tenantId,
});

describe('canViewOrder', () => {
  it.each([
    [caller('customer', 'c1'), true],
    [caller('customer', 'c2'), false],
    [caller('rider', 'r1'), true],
    [caller('rider', 'r2'), false],
    [caller('restaurant_staff', 's1', 't1'), true],
    [caller('restaurant_owner', 'o1', 't2'), false],
    [caller('restaurant_staff', 's1', null), false],
    [caller('dispatcher'), true],
    [caller('owner'), true],
  ])('%o -> %s', (who, allowed) => {
    expect(canViewOrder(who, order)).toBe(allowed);
  });

  it('hides an order from a rider who has not accepted it', () => {
    expect(canViewOrder(caller('rider', 'r1'), { ...order, riderId: null })).toBe(false);
  });
});

describe('canSeeCustomerContact', () => {
  it('shows the assigned rider the contact only while the order is open', () => {
    const rider = caller('rider', 'r1');
    const visible = ORDER_STATUSES.filter((status) =>
      canSeeCustomerContact(rider, { ...order, status }),
    );
    expect(visible).toEqual(['active', 'picked_up']);
  });

  it('never shows it to restaurants or other riders', () => {
    for (const status of ORDER_STATUSES) {
      expect(
        canSeeCustomerContact(caller('restaurant_owner', 'o', 't1'), { ...order, status }),
      ).toBe(false);
      expect(canSeeCustomerContact(caller('rider', 'r2'), { ...order, status })).toBe(false);
    }
  });

  it('shows it to the customer and to admins', () => {
    expect(canSeeCustomerContact(caller('customer', 'c1'), order)).toBe(true);
    expect(canSeeCustomerContact(caller('customer', 'c2'), order)).toBe(false);
    expect(canSeeCustomerContact(caller('dispatcher'), order)).toBe(true);
  });
});

describe('canSeeRiderContact', () => {
  const order = (status: OrderStatus, riderId: string | null = 'r1') => ({
    customerId: 'c1',
    tenantId: 't1',
    riderId,
    status,
  });
  const customer = { accountId: 'c1', role: 'customer' as const, tenantId: null };

  it('lets the customer call their rider only while the delivery is open', () => {
    expect(canSeeRiderContact(customer, order('active'))).toBe(true);
    expect(canSeeRiderContact(customer, order('picked_up'))).toBe(true);
    expect(canSeeRiderContact(customer, order('active', null))).toBe(false);
    for (const s of [
      'delivered',
      'cancelled',
      'failed',
      'rejected',
      'awaiting_restaurant',
    ] as const)
      expect(canSeeRiderContact(customer, order(s))).toBe(false);
  });

  it('hides it from other customers, restaurants and other riders', () => {
    expect(canSeeRiderContact({ ...customer, accountId: 'c2' }, order('active'))).toBe(false);
    expect(
      canSeeRiderContact(
        { accountId: 'k', role: 'restaurant_owner', tenantId: 't1' },
        order('active'),
      ),
    ).toBe(false);
    expect(
      canSeeRiderContact({ accountId: 'r2', role: 'rider', tenantId: null }, order('active')),
    ).toBe(false);
    expect(
      canSeeRiderContact(
        { accountId: 'd', role: 'dispatcher', tenantId: null },
        order('delivered'),
      ),
    ).toBe(true);
  });
});
