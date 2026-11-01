/*
 * Core data model (PRD section 14). Column names are camelCase here and snake_case in Postgres
 * (Drizzle `casing: 'snake_case'`).
 *
 * - Money is bigint cents. Ids are UUIDv7 (time-ordered, Postgres 18 `uuidv7()`).
 * - `tenantId` = the restaurant. Every tenant-owned table carries it and has an RLS policy
 *   (see drizzle/0001_rls_and_guards.sql).
 * - Columns ending in `Ciphertext` hold application-layer encrypted values (SEC-16); columns
 *   ending in `Hash` hold a keyed hash used for lookups and uniqueness.
 * - orderEvents, ledgerEntries/ledgerTransactions and auditLog are append-only (enforced by
 *   triggers). Paid settlements are immutable.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  geometry,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  DELIVERY_STATUSES,
  KITCHEN_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  ROLES,
} from '@oyo/shared';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);
const cents = () => bigint({ mode: 'number' });
const at = () => timestamp({ withTimezone: true });
const createdAt = () => at().notNull().defaultNow();
const point = () => geometry({ type: 'point', mode: 'xy', srid: 4326 });
const tenantId = () =>
  uuid()
    .notNull()
    .references(() => restaurants.id);

// Enums

export const roleEnum = pgEnum('role', ROLES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const kitchenStatusEnum = pgEnum('kitchen_status', KITCHEN_STATUSES);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);
export const accountStatusEnum = pgEnum('account_status', ['active', 'deactivated']);
export const restaurantStatusEnum = pgEnum('restaurant_status', [
  'onboarding',
  'active',
  'suspended',
]);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'confirmed', 'failed']);
export const slipStatusEnum = pgEnum('slip_status', [
  'pending',
  'approved',
  'rejected',
  'resubmit_requested',
]);
export const offerOutcomeEnum = pgEnum('offer_outcome', [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);
export const ledgerAccountEnum = pgEnum('ledger_account', [
  'business_bank', // money in the business bank account
  'gateway_clearing', // card money held by the gateway, not yet paid out
  'rider_cash', // COD cash a rider holds (partyId = rider)
  'restaurant_payable', // food revenue owed to a restaurant (partyId = restaurant)
  'rider_payable', // delivery pay owed to a rider (partyId = rider)
  'customer_credit', // credit owed to a customer (partyId = customer)
  'delivery_fee_revenue',
  'subscription_revenue',
  'refund_expense',
  'cash_variance', // shortfalls and write-offs on cash handovers
  'rider_pay_expense', // per-delivery rider pay, owed through rider_payable
]);
export const settlementStatusEnum = pgEnum('settlement_status', ['draft', 'reviewed', 'paid']);
export const settlementPartyEnum = pgEnum('settlement_party', ['restaurant', 'rider']);
export const reviewSubjectEnum = pgEnum('review_subject', ['restaurant', 'rider']);
export const supportStatusEnum = pgEnum('support_status', ['open', 'in_progress', 'resolved']);

// Settings (ADM-18): one row per key; changes go to the audit log with before and after.

export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: createdAt(),
  updatedBy: uuid().references((): AnyPgColumn => accounts.id),
});

// Restaurants (tenants)

export const restaurants = pgTable(
  'restaurants',
  {
    id: id(),
    name: text().notNull(),
    status: restaurantStatusEnum().notNull().default('onboarding'),
    location: point().notNull(),
    addressText: text().notNull(),
    cuisines: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // Home filters (CUS-03)
    prepMinutes: smallint().notNull().default(20), // typical prep time, for the ETA
    pausedUntil: at(),
    licenceNumber: text(),
    licenceExpiresOn: date(),
    bankDetailsCiphertext: bytea(),
    subscriptionStatus: text().notNull().default('trial'),
    createdAt: createdAt(),
  },
  (t) => [index().using('gist', t.location)],
);

export const restaurantHours = pgTable(
  'restaurant_hours',
  {
    id: id(),
    tenantId: tenantId(),
    weekday: smallint().notNull(), // 0 = Sunday, Asia/Colombo
    opensAt: time().notNull(),
    closesAt: time().notNull(),
  },
  (t) => [
    index().on(t.tenantId, t.weekday),
    check('weekday_range', sql`${t.weekday} between 0 and 6`),
  ],
);

export const restaurantHourOverrides = pgTable(
  'restaurant_hour_overrides',
  {
    id: id(),
    tenantId: tenantId(),
    date: date().notNull(),
    closed: boolean().notNull().default(true),
    opensAt: time(),
    closesAt: time(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.date)],
);

// Accounts: one role per account. Restaurant roles belong to exactly one tenant.

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    role: roleEnum().notNull(),
    status: accountStatusEnum().notNull().default('active'),
    displayName: text().notNull(),
    tenantId: uuid().references(() => restaurants.id),
    phoneHash: text(),
    phoneCiphertext: bytea(),
    username: text(),
    passwordHash: text(),
    mustChangePassword: boolean().notNull().default(false),
    passwordChangedAt: at(),
    failedLoginCount: smallint().notNull().default(0),
    lockedUntil: at(),
    totpSecretCiphertext: bytea(),
    totpPendingSecretCiphertext: bytea(), // set during enrolment, moved to totpSecret on confirm
    totpLastStep: bigint({ mode: 'number' }), // last accepted TOTP time step, blocks code replay
    termsAcceptedAt: at(), // customers: privacy notice, terms and 18+ confirmation (PRI-03, PRI-12)
    marketingOptIn: boolean().notNull().default(false), // offers and news only (NOT-03)
    createdAt: createdAt(),
    deactivatedAt: at(),
  },
  (t) => [
    uniqueIndex().on(t.phoneHash),
    uniqueIndex('accounts_username_lower_idx').on(sql`lower(${t.username})`),
    check(
      'tenant_only_for_restaurant_roles',
      sql`(${t.role} in ('restaurant_staff', 'restaurant_owner')) = (${t.tenantId} is not null)`,
    ),
    check('customer_signs_in_by_phone', sql`${t.role} <> 'customer' or ${t.phoneHash} is not null`),
    check(
      'staff_sign_in_by_username',
      sql`${t.role} = 'customer' or (${t.username} is not null and ${t.passwordHash} is not null)`,
    ),
  ],
);

// Auth (SEC-01 to SEC-08). All platform-only under RLS.

/** One row per OTP sent. Only an HMAC of the code is stored. */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    phoneHash: text().notNull(),
    codeHash: text().notNull(),
    attempts: smallint().notNull().default(0),
    lockedUntil: at(), // set on the 5th wrong code: no new codes or attempts for this phone until then
    ip: inet(),
    createdAt: createdAt(),
    expiresAt: at().notNull(),
    consumedAt: at(),
  },
  (t) => [index().on(t.phoneHash, t.createdAt)],
);

export const deviceStatusEnum = pgEnum('device_status', ['approved', 'pending', 'revoked']);

/** Device binding for riders and restaurant users (SEC-06). */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    deviceId: text().notNull(), // stable id generated by the app on first launch
    platform: text(),
    status: deviceStatusEnum().notNull(),
    approvedBy: uuid().references(() => accounts.id),
    firstSeenAt: createdAt(),
    lastSeenAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.accountId, t.deviceId)],
);

/**
 * One row per issued token pair. Refreshing creates a new row in the same family and marks the
 * old one rotated; presenting a rotated refresh token again revokes the whole family (SEC-04).
 * Tokens are stored as SHA-256 hashes.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    familyId: uuid().notNull(),
    deviceId: text(),
    accessTokenHash: text().notNull(),
    refreshTokenHash: text().notNull(),
    accessExpiresAt: at().notNull(),
    refreshExpiresAt: at().notNull(),
    /** Limited sessions may only change the password or enrol TOTP. */
    limited: boolean().notNull().default(false),
    ip: inet(),
    createdAt: createdAt(),
    rotatedAt: at(),
    revokedAt: at(),
    revokeReason: text(),
  },
  (t) => [
    uniqueIndex().on(t.accessTokenHash),
    uniqueIndex().on(t.refreshTokenHash),
    index().on(t.familyId),
    index().on(t.accountId),
  ],
);

/**
 * Idempotency keys for money-moving endpoints (SEC-22). A retry with the same key and body gets
 * the stored response; the same key with a different body is refused. Expired rows are purged.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    key: text().notNull(),
    requestHash: text().notNull(),
    responseBody: jsonb(), // replayed with the route's own status code
    createdAt: createdAt(),
    completedAt: at(),
    expiresAt: at().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.key] }), index().on(t.expiresAt)],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => accounts.id),
    label: text().notNull(),
    location: point().notNull(),
    addressCiphertext: bytea().notNull(),
    noteCiphertext: bytea(),
    createdAt: createdAt(),
    deletedAt: at(),
  },
  (t) => [index().on(t.customerId)],
);

// Menu

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: id(),
    tenantId: tenantId(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index().on(t.tenantId)],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: id(),
    tenantId: tenantId(),
    categoryId: uuid()
      .notNull()
      .references(() => menuCategories.id),
    name: text().notNull(),
    description: text(),
    priceCents: cents().notNull(),
    photoKey: text(),
    dietaryTags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    soldOut: boolean().notNull().default(false),
    approvalStatus: approvalStatusEnum().notNull().default('pending'),
    archivedAt: at(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.categoryId), check('price_positive', sql`${t.priceCents} > 0`)],
);

export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: id(),
    tenantId: tenantId(),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id),
    name: text().notNull(),
    minSelect: smallint().notNull().default(0),
    maxSelect: smallint().notNull().default(1),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    index().on(t.menuItemId),
    check('select_range', sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect}`),
  ],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: id(),
    tenantId: tenantId(),
    groupId: uuid()
      .notNull()
      .references(() => modifierGroups.id),
    name: text().notNull(),
    priceCents: cents().notNull().default(0),
    soldOut: boolean().notNull().default(false),
  },
  (t) => [index().on(t.groupId), check('price_not_negative', sql`${t.priceCents} >= 0`)],
);

/** Price changes and new items wait for admin approval (RES-08, ADM-12). */
export const menuChangeRequests = pgTable(
  'menu_change_requests',
  {
    id: id(),
    tenantId: tenantId(),
    menuItemId: uuid().references(() => menuItems.id),
    kind: text().notNull(), // 'new_item' | 'price_change' | 'edit'
    before: jsonb(),
    after: jsonb().notNull(),
    status: approvalStatusEnum().notNull().default('pending'),
    adminNote: text(),
    requestedBy: uuid()
      .notNull()
      .references(() => accounts.id),
    reviewedBy: uuid().references(() => accounts.id),
    createdAt: createdAt(),
    reviewedAt: at(),
  },
  (t) => [index().on(t.tenantId, t.status)],
);

// Riders

export const riders = pgTable(
  'riders',
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id),
    vehicleType: text().notNull(),
    plate: text().notNull(),
    photoKey: text(),
    online: boolean().notNull().default(false),
    paused: boolean().notNull().default(false),
    consecutiveMisses: smallint().notNull().default(0),
    lastLocation: point(),
    lastSeenAt: at(),
    emergencyContactCiphertext: bytea(),
    nicCiphertext: bytea(), // national ID number, encrypted (SEC-16)
  },
  (t) => [index().using('gist', t.lastLocation)],
);

export const riderDocuments = pgTable(
  'rider_documents',
  {
    id: id(),
    riderId: uuid()
      .notNull()
      .references(() => riders.accountId),
    kind: text().notNull(),
    fileKey: text().notNull(),
    documentNumberCiphertext: bytea(),
    expiresOn: date(),
    uploadedAt: createdAt(),
  },
  (t) => [index().on(t.riderId)],
);

/** Location trail, kept 90 days (PRI-04). */
export const riderLocations = pgTable(
  'rider_locations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    riderId: uuid()
      .notNull()
      .references(() => riders.accountId),
    location: point().notNull(),
    batteryPercent: smallint(),
    mock: boolean().notNull().default(false),
    recordedAt: at().notNull(),
  },
  (t) => [index().on(t.riderId, t.recordedAt)],
);

// Orders

export const batches = pgTable('batches', {
  id: id(),
  riderId: uuid().references(() => riders.accountId),
  createdBy: uuid()
    .notNull()
    .references(() => accounts.id),
  createdAt: createdAt(),
});

export const orders = pgTable(
  'orders',
  {
    id: id(),
    tenantId: tenantId(),
    reference: text().notNull(), // short code customers and riders read out
    customerId: uuid()
      .notNull()
      .references(() => accounts.id),
    paymentMethod: paymentMethodEnum().notNull(),
    status: orderStatusEnum().notNull(),
    kitchenStatus: kitchenStatusEnum(),
    deliveryStatus: deliveryStatusEnum(),
    riderId: uuid().references(() => riders.accountId),
    batchId: uuid().references(() => batches.id),
    // Delivery address snapshot, removed 12 months after close (retention schedule).
    deliveryLocation: point().notNull(),
    deliveryAddressCiphertext: bytea(),
    deliveryNoteCiphertext: bytea(),
    // Fee inputs and totals, locked at placement.
    routeDistanceMeters: integer().notNull(),
    feeSettings: jsonb().notNull(),
    itemsCents: cents().notNull(),
    deliveryFeeCents: cents().notNull(),
    restaurantFeeCents: cents().notNull().default(0),
    totalCents: cents().notNull(),
    prepMinutes: smallint(),
    cashCollectedCents: cents(), // COD: what the rider took at the door (RID-08)
    cashVarianceReason: text(),
    placedAt: createdAt(),
    closedAt: at(),
    version: integer().notNull().default(0), // optimistic concurrency on status changes
  },
  (t) => [
    uniqueIndex().on(t.reference),
    index().on(t.tenantId, t.status),
    index().on(t.customerId, t.placedAt),
    index().on(t.riderId),
    index().on(t.status, t.deliveryStatus),
    check(
      'total_adds_up',
      sql`${t.totalCents} = ${t.itemsCents} + ${t.deliveryFeeCents} + ${t.restaurantFeeCents}`,
    ),
    check(
      'tracks_set_after_accept',
      sql`(${t.kitchenStatus} is null) = (${t.deliveryStatus} is null)`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    menuItemId: uuid()
      .notNull()
      .references(() => menuItems.id),
    // Snapshot of what was bought.
    name: text().notNull(),
    unitPriceCents: cents().notNull(),
    modifiers: jsonb().notNull().default([]), // [{ id, name, priceCents }]
    quantity: smallint().notNull(),
    lineTotalCents: cents().notNull(),
    note: text(),
  },
  (t) => [index().on(t.orderId), check('quantity_positive', sql`${t.quantity} > 0`)],
);

/** Append-only. The order timeline is rebuilt from these rows. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    /** Insertion order: events written in one transaction share a timestamp. */
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    type: text().notNull(),
    actorAccountId: uuid().references(() => accounts.id), // null = system
    actorRole: text().notNull(), // a role, or 'system'
    deviceId: text(),
    payload: jsonb().notNull().default({}),
    occurredAt: createdAt(),
  },
  (t) => [index().on(t.orderId, t.occurredAt)],
);

export const offers = pgTable(
  'offers',
  {
    id: id(),
    orderId: uuid().references(() => orders.id),
    batchId: uuid().references(() => batches.id),
    riderId: uuid()
      .notNull()
      .references(() => riders.accountId),
    offeredBy: uuid()
      .notNull()
      .references(() => accounts.id),
    payoutCents: cents().notNull(),
    outcome: offerOutcomeEnum().notNull().default('pending'),
    reason: text(),
    sentAt: createdAt(),
    expiresAt: at().notNull(),
    respondedAt: at(),
  },
  (t) => [
    check('order_xor_batch', sql`(${t.orderId} is null) <> (${t.batchId} is null)`),
    // One live offer per order or batch at a time.
    uniqueIndex('offers_one_pending_per_order')
      .on(t.orderId)
      .where(sql`${t.outcome} = 'pending' and ${t.orderId} is not null`),
    uniqueIndex('offers_one_pending_per_batch')
      .on(t.batchId)
      .where(sql`${t.outcome} = 'pending' and ${t.batchId} is not null`),
    index().on(t.riderId, t.sentAt),
  ],
);

/** The 30-second soft lock a dispatcher holds while assigning (ADM rule, section 8 rule 6). */
export const assignmentLocks = pgTable('assignment_locks', {
  orderId: uuid()
    .primaryKey()
    .references(() => orders.id),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  expiresAt: at().notNull(),
});

// Payments

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    method: paymentMethodEnum().notNull(),
    amountCents: cents().notNull(),
    status: paymentStatusEnum().notNull().default('pending'),
    gatewayReference: text(),
    createdAt: createdAt(),
    confirmedAt: at(),
  },
  (t) => [index().on(t.orderId), uniqueIndex().on(t.gatewayReference)],
);

export const bankSlips = pgTable(
  'bank_slips',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    imageKey: text().notNull(),
    imageSha256: text().notNull(),
    bankReference: text(),
    declaredAmountCents: cents(),
    status: slipStatusEnum().notNull().default('pending'),
    reviewedBy: uuid().references(() => accounts.id),
    reviewReason: text(),
    uploadedAt: createdAt(),
    reviewedAt: at(),
  },
  (t) => [
    // SEC-24: the same image or bank reference cannot back two orders.
    uniqueIndex().on(t.imageSha256),
    uniqueIndex().on(t.bankReference),
    index().on(t.status, t.uploadedAt),
  ],
);

export const cashHandovers = pgTable(
  'cash_handovers',
  {
    id: id(),
    riderId: uuid()
      .notNull()
      .references(() => riders.accountId),
    amountCents: cents().notNull(),
    expectedCents: cents().notNull(),
    varianceReason: text(),
    receiptKey: text(),
    recordedBy: uuid()
      .notNull()
      .references(() => accounts.id),
    countersignedBy: uuid().references(() => accounts.id),
    recordedAt: createdAt(),
  },
  (t) => [
    index().on(t.riderId, t.recordedAt),
    check(
      'variance_needs_reason',
      sql`${t.amountCents} = ${t.expectedCents} or ${t.varianceReason} is not null`,
    ),
  ],
);

// Ledger: double-entry and append-only. Each transaction's entries sum to zero (checked at
// commit). Positive amounts are debits, negative are credits. Corrections are reversing
// transactions.

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: id(),
    kind: text().notNull(),
    orderId: uuid().references(() => orders.id),
    reversesId: uuid().references((): AnyPgColumn => ledgerTransactions.id),
    memo: text(),
    createdBy: uuid().references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId), uniqueIndex().on(t.reversesId)],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    transactionId: uuid()
      .notNull()
      .references(() => ledgerTransactions.id),
    account: ledgerAccountEnum().notNull(),
    partyId: uuid(), // rider, restaurant or customer for party accounts
    amountCents: cents().notNull(),
  },
  (t) => [
    index().on(t.transactionId),
    index().on(t.account, t.partyId),
    check('amount_not_zero', sql`${t.amountCents} <> 0`),
  ],
);

/** Immutable once paid, with a checksum (section 9). */
export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    party: settlementPartyEnum().notNull(),
    partyId: uuid().notNull(),
    tenantId: uuid().references(() => restaurants.id), // set for restaurant settlements
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    totalCents: cents().notNull(),
    status: settlementStatusEnum().notNull().default('draft'),
    checksum: text(),
    createdAt: createdAt(),
    paidAt: at(),
  },
  (t) => [
    uniqueIndex().on(t.party, t.partyId, t.periodStart),
    check(
      'restaurant_settlement_has_tenant',
      sql`(${t.party} = 'restaurant') = (${t.tenantId} is not null)`,
    ),
    check('paid_has_checksum', sql`${t.status} <> 'paid' or ${t.checksum} is not null`),
  ],
);

export const settlementLines = pgTable(
  'settlement_lines',
  {
    id: id(),
    settlementId: uuid()
      .notNull()
      .references(() => settlements.id),
    tenantId: uuid().references(() => restaurants.id),
    orderId: uuid().references(() => orders.id),
    description: text().notNull(),
    amountCents: cents().notNull(),
  },
  (t) => [index().on(t.settlementId)],
);

// Reviews and support

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    customerId: uuid()
      .notNull()
      .references(() => accounts.id),
    subject: reviewSubjectEnum().notNull(),
    riderId: uuid().references(() => riders.accountId),
    rating: smallint().notNull(),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    body: text(),
    reply: text(),
    hidden: boolean().notNull().default(false),
    createdAt: createdAt(),
    editableUntil: at().notNull(),
  },
  (t) => [
    uniqueIndex().on(t.orderId, t.subject),
    index().on(t.tenantId, t.createdAt),
    check('rating_range', sql`${t.rating} between 1 and 5`),
    check('rider_review_has_rider', sql`(${t.subject} = 'rider') = (${t.riderId} is not null)`),
  ],
);

export const supportCases = pgTable(
  'support_cases',
  {
    id: id(),
    orderId: uuid().references(() => orders.id),
    tenantId: uuid().references(() => restaurants.id),
    reporterId: uuid()
      .notNull()
      .references(() => accounts.id),
    type: text().notNull(),
    description: text(),
    evidenceKeys: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: supportStatusEnum().notNull().default('open'),
    assigneeId: uuid().references(() => accounts.id),
    resolution: text(),
    createdAt: createdAt(),
    resolvedAt: at(),
  },
  (t) => [index().on(t.status, t.createdAt), index().on(t.orderId)],
);

// Audit log (SEC-31): append-only.

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorAccountId: uuid().references(() => accounts.id),
    actorRole: text().notNull(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    deviceId: text(),
    occurredAt: createdAt(),
  },
  (t) => [
    index().on(t.occurredAt),
    index().on(t.actorAccountId, t.occurredAt),
    index().on(t.targetType, t.targetId),
  ],
);
