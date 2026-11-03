import { can, type Role } from '@oyo/shared';

/** What the database trigger sends on channel oyo_live (drizzle/0012_live_notify.sql). */
export type LiveNotice =
  | {
      kind: 'order';
      orderId: string;
      type: string;
      tenantId: string;
      customerId: string;
      riderIds: string[];
    }
  | { kind: 'menu'; tenantId: string };

/** What a client receives: enough to know what to refetch, nothing more. */
export type LiveMessage = { kind: 'order'; orderId: string; type: string } | { kind: 'menu' };

/** Rooms a signed-in socket joins. */
export function roomsForAccount(a: {
  accountId: string;
  role: Role;
  tenantId: string | null;
}): string[] {
  const rooms = [`account:${a.accountId}`];
  if (can(a.role, 'orders.view_all')) rooms.push('dispatch');
  if (can(a.role, 'menu_approvals.review')) rooms.push('menu-review');
  if (a.tenantId && (a.role === 'restaurant_owner' || a.role === 'restaurant_staff'))
    rooms.push(`tenant:${a.tenantId}`);
  return rooms;
}

/** Who hears about a notice: the parties to the order (or the menu), and the office. */
export function route(n: LiveNotice): { rooms: string[]; message: LiveMessage } {
  if (n.kind === 'menu') {
    return { rooms: [`tenant:${n.tenantId}`, 'menu-review'], message: { kind: 'menu' } };
  }
  return {
    rooms: [
      'dispatch',
      `tenant:${n.tenantId}`,
      `account:${n.customerId}`,
      ...n.riderIds.map((r) => `account:${r}`),
    ],
    message: { kind: 'order', orderId: n.orderId, type: n.type },
  };
}
