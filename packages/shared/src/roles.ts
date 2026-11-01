/** One account holds exactly one role (PRD section 2). */
export const ROLES = [
  'customer',
  'rider',
  'restaurant_staff',
  'restaurant_owner',
  'dispatcher',
  'owner',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that must use TOTP two-factor authentication (SEC-03). */
export const ROLES_REQUIRING_2FA: readonly Role[] = ['restaurant_owner', 'dispatcher', 'owner'];

const CUSTOMER = [
  'order.place',
  'order.view_own',
  'order.cancel_own',
  'order.rate',
  'order.report_problem',
  'profile.manage_own',
] as const;

const RIDER = [
  'job.view_own',
  'job.respond_offer',
  'job.update_status',
  'job.report_issue',
  'rider.go_online',
  'rider.emergency',
  'earnings.view_own',
  'cash.view_own',
] as const;

const RESTAURANT_STAFF = [
  'restaurant.orders.view',
  'restaurant.orders.respond',
  'restaurant.orders.update',
  'restaurant.menu.edit',
  'restaurant.hours.edit',
  'restaurant.reviews.reply',
] as const;

const RESTAURANT_OWNER_EXTRA = [
  'restaurant.payouts.view',
  'restaurant.staff.manage',
  'restaurant.bank_details.manage',
] as const;

const DISPATCHER = [
  'orders.view_all',
  'orders.assign',
  'orders.cancel',
  'orders.reassign',
  'riders.view',
  'riders.manage_status',
  'live_map.view',
  'accounts.create_rider',
  'accounts.create_restaurant_user',
  'cash_handover.record',
  'bank_slips.review',
  'customers.view',
  'customers.flag',
  'refunds.issue_within_cap',
  'support.manage',
] as const;

const OWNER_EXTRA = [
  'refunds.issue_any',
  'customers.block',
  'restaurants.manage',
  'menu_approvals.review',
  'settlements.manage',
  'rider_payouts.manage',
  'reports.view',
  'settings.edit',
  'staff.manage',
  'accounts.create_dispatcher',
  'audit_log.view',
  'broadcast.send',
  'cash.write_off',
] as const;

export type Permission =
  | (typeof CUSTOMER)[number]
  | (typeof RIDER)[number]
  | (typeof RESTAURANT_STAFF)[number]
  | (typeof RESTAURANT_OWNER_EXTRA)[number]
  | (typeof DISPATCHER)[number]
  | (typeof OWNER_EXTRA)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  customer: new Set(CUSTOMER),
  rider: new Set(RIDER),
  restaurant_staff: new Set(RESTAURANT_STAFF),
  restaurant_owner: new Set([...RESTAURANT_STAFF, ...RESTAURANT_OWNER_EXTRA]),
  dispatcher: new Set(DISPATCHER),
  owner: new Set([...DISPATCHER, ...OWNER_EXTRA]),
};

/**
 * Role check only, deny by default. The API must also run the object-level check
 * (own order, own job, own restaurant) on every request (SEC-10).
 */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
