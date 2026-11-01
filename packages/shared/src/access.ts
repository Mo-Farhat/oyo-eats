import type { OrderStatus } from './order-state.js';
import type { Role } from './roles.js';

/*
 * Object-level access (SEC-10) and just-in-time field exposure (SEC-12) for orders. Role
 * permissions (roles.ts) say what a role may do at all; these say which records it may touch.
 */

export interface Caller {
  accountId: string;
  role: Role;
  tenantId: string | null;
}

export interface OrderParties {
  customerId: string;
  tenantId: string;
  riderId: string | null;
  status: OrderStatus;
}

const isRestaurant = (role: Role) => role === 'restaurant_staff' || role === 'restaurant_owner';
const isAdmin = (role: Role) => role === 'dispatcher' || role === 'owner';

export function canViewOrder(caller: Caller, order: OrderParties): boolean {
  if (isAdmin(caller.role)) return true;
  if (caller.role === 'customer') return order.customerId === caller.accountId;
  if (caller.role === 'rider') return order.riderId === caller.accountId;
  if (isRestaurant(caller.role))
    return caller.tenantId !== null && order.tenantId === caller.tenantId;
  return false;
}

/**
 * Customer phone and full address. The rider sees them only while the order is theirs and open:
 * after accepting, until the order closes. Restaurants never see them; the first name and delivery
 * area are enough to cook.
 */
export function canSeeCustomerContact(caller: Caller, order: OrderParties): boolean {
  if (caller.role === 'customer') return order.customerId === caller.accountId;
  if (isAdmin(caller.role)) return true;
  if (caller.role === 'rider') {
    return (
      order.riderId === caller.accountId &&
      (order.status === 'active' || order.status === 'picked_up')
    );
  }
  return false;
}

/**
 * The assigned rider's phone, for the customer to call while the delivery is under way (CUS-12):
 * from the rider accepting until the order closes. Restaurants call through dispatch.
 */
export function canSeeRiderContact(caller: Caller, order: OrderParties): boolean {
  if (!order.riderId) return false;
  if (isAdmin(caller.role)) return true;
  if (caller.role === 'customer') {
    return (
      order.customerId === caller.accountId &&
      (order.status === 'active' || order.status === 'picked_up')
    );
  }
  return false;
}
