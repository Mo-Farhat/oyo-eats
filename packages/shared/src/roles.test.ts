import { describe, expect, it } from 'vitest';
import { can, ROLES, type Role } from './roles.js';

describe('can', () => {
  it('keeps money and settings with the owner', () => {
    for (const permission of [
      'settings.edit',
      'refunds.issue_any',
      'staff.manage',
      'audit_log.view',
    ] as const) {
      expect(can('owner', permission)).toBe(true);
      expect(can('dispatcher', permission)).toBe(false);
    }
  });

  it('lets dispatchers refund only within the cap', () => {
    expect(can('dispatcher', 'refunds.issue_within_cap')).toBe(true);
    expect(can('owner', 'refunds.issue_within_cap')).toBe(true);
  });

  it('only admins assign riders', () => {
    const allowed = ROLES.filter((role) => can(role, 'orders.assign'));
    expect(allowed).toEqual(['dispatcher', 'owner']);
  });

  it('gives restaurant owners staff permissions plus payouts and staff', () => {
    expect(can('restaurant_owner', 'restaurant.orders.respond')).toBe(true);
    expect(can('restaurant_owner', 'restaurant.payouts.view')).toBe(true);
    expect(can('restaurant_staff', 'restaurant.payouts.view')).toBe(false);
    expect(can('restaurant_staff', 'restaurant.staff.manage')).toBe(false);
  });

  it('keeps faces apart', () => {
    expect(can('customer', 'orders.view_all')).toBe(false);
    expect(can('rider', 'restaurant.orders.view')).toBe(false);
    expect(can('restaurant_owner', 'orders.assign')).toBe(false);
  });

  it('denies unknown roles', () => {
    expect(can('hacker' as Role, 'order.place')).toBe(false);
  });
});
