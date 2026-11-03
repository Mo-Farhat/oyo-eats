import { z } from 'zod';
import { ITEM_CHANGE_CHOICES } from './item-changes.js';
import { PAYMENT_METHODS } from './order-state.js';

/** Mobile prefixes in use in Sri Lanka: 070-072 and 074-078. */
const LOCAL_MOBILE = /^7[0124-8]\d{7}$/;

/**
 * Accepts 0771234567, 771234567, 94771234567 or +94 77 123 4567 (spaces and dashes allowed)
 * and returns E.164 (+94771234567), or null if it is not a Sri Lankan mobile number.
 */
export function normalizeSriLankanMobile(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  const local = compact.replace(/^(\+94|0094|94|0)/, '');
  return LOCAL_MOBILE.test(local) ? `+94${local}` : null;
}

export const sriLankanMobileSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeSriLankanMobile(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter a Sri Lankan mobile number' });
    return z.NEVER;
  }
  return normalized;
});

// Auth (CUS-01, SEC-01 to SEC-06)

/** Stable id the app generates on first launch and keeps in the secure store (SEC-06). */
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, 'Invalid device id');
const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const requestOtpSchema = z.strictObject({ phone: sriLankanMobileSchema });

export const verifyOtpSchema = z.strictObject({
  phone: sriLankanMobileSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  /** Privacy notice, terms and 18+ confirmation; required when this sign-in creates the account. */
  acceptTerms: z.boolean().optional(),
  deviceId: deviceIdSchema.optional(),
});

export const staffLoginSchema = z.strictObject({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(1).max(256),
  deviceId: deviceIdSchema.optional(),
  platform: z.enum(['ios', 'android']).optional(),
  totpCode: totpCodeSchema.optional(),
});

export const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(200) });

/** The breached-password check runs on the server. */
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(10, 'Use at least 10 characters').max(256),
});

export const confirmTotpSchema = z.strictObject({ code: totpCodeSchema });

// Orders. Clients send ids and quantities only; prices, fees and totals are computed by the
// server (SEC-23). Strict objects reject any extra field such as a client-side total.

export const orderLineInputSchema = z.strictObject({
  menuItemId: z.uuid(),
  quantity: z.int().min(1).max(50),
  modifierIds: z.array(z.uuid()).max(20).default([]),
  note: z.string().trim().max(200).optional(),
});

export const placeOrderSchema = z.strictObject({
  restaurantId: z.uuid(),
  addressId: z.uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  items: z.array(orderLineInputSchema).min(1).max(50),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ConfirmTotpInput = z.infer<typeof confirmTotpSchema>;
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

// Customer: addresses (CUS-02) and browsing (CUS-03)

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const addressInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(30),
  lat: latitude,
  lng: longitude,
  addressText: z.string().trim().min(3).max(300),
  note: z.string().trim().max(300).optional(),
});

export const addressUpdateSchema = addressInputSchema.partial();

/** Query string for the restaurant list; numbers arrive as strings. */
export const restaurantQuerySchema = z.strictObject({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
  q: z.string().trim().max(60).optional(),
  cuisine: z.string().trim().max(40).optional(),
});

/** Optional point for fee and ETA on the restaurant page. */
export const pointQuerySchema = z.strictObject({
  lat: z.coerce.number().pipe(latitude).optional(),
  lng: z.coerce.number().pipe(longitude).optional(),
});

/** A quote is a draft order: the payment method is optional (CUS-07). */
export const quoteOrderSchema = placeOrderSchema.extend({
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
export type AddressUpdate = z.infer<typeof addressUpdateSchema>;
export type RestaurantQuery = z.infer<typeof restaurantQuerySchema>;
export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>;

// Bank transfer (CUS-09, ADM-10)

/** Form fields sent with the slip image (multipart). */
export const slipUploadSchema = z.strictObject({
  bankReference: z.string().trim().max(60).optional(),
});

export const slipRejectSchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
  /** Ask the customer for a new slip instead of a final rejection. */
  resubmit: z.boolean().default(true),
});

export type SlipUploadInput = z.infer<typeof slipUploadSchema>;
export type SlipRejectInput = z.infer<typeof slipRejectSchema>;

// Ratings (CUS-16), profile (CUS-18)

export const RESTAURANT_REVIEW_TAGS = [
  'Tasty',
  'Hot & fresh',
  'Good portion',
  'Well packed',
  'Cold',
  'Wrong item',
  'Missing item',
] as const;
export const RIDER_REVIEW_TAGS = [
  'On time',
  'Friendly',
  'Careful with food',
  'Late',
  'Rude',
  'Food spilled',
] as const;

/** Ratings can be edited for this long after delivery (CUS-16). */
export const RATING_EDIT_HOURS = 24;

const stars = z.int().min(1).max(5);

export const rateOrderSchema = z.strictObject({
  restaurant: z.strictObject({
    rating: stars,
    tags: z.array(z.enum(RESTAURANT_REVIEW_TAGS)).max(RESTAURANT_REVIEW_TAGS.length).default([]),
    body: z.string().trim().max(500).optional(),
  }),
  rider: z
    .strictObject({
      rating: stars,
      tags: z.array(z.enum(RIDER_REVIEW_TAGS)).max(RIDER_REVIEW_TAGS.length).default([]),
    })
    .optional(),
});

export const profileUpdateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60).optional(),
  /** Offers and news only; order updates can't be muted (NOT-03). */
  marketingOptIn: z.boolean().optional(),
});

export const phoneChangeRequestSchema = z.strictObject({ phone: sriLankanMobileSchema });
export const phoneChangeVerifySchema = z.strictObject({
  phone: sriLankanMobileSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type RateOrderInput = z.infer<typeof rateOrderSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PhoneChangeVerifyInput = z.infer<typeof phoneChangeVerifySchema>;

// Restaurant order handling (RES-03 to RES-06, RES-10)

export const REJECT_REASONS = ['item_unavailable', 'too_busy', 'closing_soon', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** Prep time presets offered on accept (RES-04); custom values must stay in this range. */
export const PREP_PRESETS = [10, 15, 20, 30, 45, 60] as const;

export const acceptOrderSchema = z.strictObject({ prepMinutes: z.int().min(5).max(90) });

export const rejectOrderSchema = z.strictObject({
  reason: z.enum(REJECT_REASONS),
  /** With item_unavailable: these items are marked sold out on the menu. */
  soldOutItemIds: z.array(z.uuid()).max(50).default([]),
  note: z.string().trim().max(200).optional(),
});

export const delayOrderSchema = z.strictObject({ minutes: z.int().min(1).max(30) });

/** The board's Open switch: closed means paused until reopened (RES-10). */
export const storeStatusSchema = z.strictObject({
  open: z.boolean(),
  /** Pause for this long (RES-10); without it, closed until reopened. */
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

/** RES-05: part or all of a line can't be made; optionally offer a substitute from the menu. */
export const markItemUnavailableSchema = z.strictObject({
  orderItemId: z.uuid(),
  /** How many of the line the kitchen can still make. */
  availableQuantity: z.int().min(0).max(99).default(0),
  substituteMenuItemId: z.uuid().optional(),
  /** Also mark the item sold out on the menu. */
  markSoldOut: z.boolean().default(false),
});

export const itemChangeChoiceSchema = z.strictObject({ choice: z.enum(ITEM_CHANGE_CHOICES) });

export type MarkItemUnavailableInput = z.infer<typeof markItemUnavailableSchema>;
export type ItemChangeChoiceInput = z.infer<typeof itemChangeChoiceSchema>;
export type AcceptOrderInput = z.infer<typeof acceptOrderSchema>;
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;
export type DelayOrderInput = z.infer<typeof delayOrderSchema>;

// Dispatch (ADM-03, ADM-05) and rider jobs (RID-02 to RID-08)

export const offerSchema = z.strictObject({ riderId: z.uuid() });

export const riderStatusSchema = z.strictObject({ online: z.boolean() });

export const riderLocationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  batteryPercent: z.int().min(0).max(100).optional(),
  /** The OS says the position is simulated (SEC-28). */
  mock: z.boolean().optional(),
});

export const declineOfferSchema = z.strictObject({
  reason: z.enum(['too_far', 'vehicle_issue', 'on_break', 'other']),
});

export const deliverSchema = z.strictObject({
  /** Cash taken at the door, for COD (RID-08). */
  cashCollectedCents: z.int().min(0).optional(),
  /** Required when the cash differs from the total. */
  varianceReason: z.string().trim().min(3).max(200).optional(),
});

export type DeliverInput = z.infer<typeof deliverSchema>;
export type RiderLocationInput = z.infer<typeof riderLocationSchema>;

// Admin: accounts (ADM-08, ADM-19) and restaurant onboarding (ADM-11)

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,40}$/, 'Use 3-40 letters, numbers, dots or dashes');

export const createAccountSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('rider'),
    displayName: z.string().trim().min(2).max(60),
    username: username.optional(),
    /** Customers call the rider on this while the delivery is open (CUS-12). */
    phone: sriLankanMobileSchema,
    vehicleType: z.string().trim().min(2).max(40),
    plate: z.string().trim().min(2).max(20),
    nicNumber: z.string().trim().min(5).max(20).optional(),
  }),
  z.strictObject({
    role: z.enum(['restaurant_owner', 'restaurant_staff']),
    displayName: z.string().trim().min(2).max(60),
    username: username.optional(),
    phone: sriLankanMobileSchema.optional(),
    tenantId: z.uuid(),
  }),
  z.strictObject({
    role: z.literal('dispatcher'),
    displayName: z.string().trim().min(2).max(60),
    username: username.optional(),
    phone: sriLankanMobileSchema.optional(),
  }),
]);

export const accountStatusSchema = z.strictObject({ active: z.boolean() });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const restaurantInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  addressText: z.string().trim().min(3).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  cuisines: z.array(z.string().trim().min(2).max(30)).max(8).default([]),
  prepMinutes: z.int().min(5).max(90).default(20),
  licenceNumber: z.string().trim().min(2).max(60).optional(),
  /** YYYY-MM-DD. Ordering is blocked once it lapses (section 12). */
  licenceExpiresOn: z.iso.date().optional(),
  bankDetails: z
    .strictObject({
      bankName: z.string().trim().min(2).max(60),
      branch: z.string().trim().min(2).max(60),
      accountName: z.string().trim().min(2).max(80),
      accountNumber: z.string().trim().min(4).max(30),
    })
    .optional(),
});

export const restaurantUpdateSchema = restaurantInputSchema.partial();

export const restaurantStatusSchema = z.strictObject({
  status: z.enum(['onboarding', 'active', 'suspended']),
});

export const hoursSchema = z.strictObject({
  weekly: z
    .array(z.strictObject({ weekday: z.int().min(0).max(6), opensAt: hhmm, closesAt: hhmm }))
    .max(28),
});

export const categoryInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  sortOrder: z.int().min(0).max(999).default(0),
});

export const menuItemInputSchema = z.strictObject({
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  priceCents: z.int().min(100).max(10_000_000),
  dietaryTags: z.array(z.string().trim().max(20)).max(6).default([]),
  groups: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(40),
        minSelect: z.int().min(0).max(10),
        maxSelect: z.int().min(1).max(10),
        options: z
          .array(
            z.strictObject({
              name: z.string().trim().min(1).max(40),
              priceCents: z.int().min(0).max(1_000_000),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .max(6)
    .default([]),
});

export const menuItemUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  priceCents: z.int().min(100).max(10_000_000).optional(),
  soldOut: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type RestaurantInput = z.infer<typeof restaurantInputSchema>;
export type RestaurantUpdate = z.infer<typeof restaurantUpdateSchema>;
export type HoursInput = z.infer<typeof hoursSchema>;
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export type MenuItemUpdate = z.infer<typeof menuItemUpdateSchema>;

/** Dispatch cancelling an order or marking a delivery failed (A02, A22). */
export const adminOrderActionSchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
});
export type AdminOrderActionInput = z.infer<typeof adminOrderActionSchema>;

/** A11: cash a rider hands to the office (ADM-09). A difference from the expected needs a reason. */
export const cashHandoverSchema = z.strictObject({
  amountCents: z.int().min(0).max(100_000_000),
  /** What the office saw, said to the rider's face. Required when the amount differs. */
  reason: z.string().trim().min(3).max(200).optional(),
});
export type CashHandoverInput = z.infer<typeof cashHandoverSchema>;

export const generateSettlementsSchema = z.strictObject({
  party: z.enum(['restaurant', 'rider']),
  /** First day of the period (YYYY-MM-DD, Asia/Colombo). Weekly cycles start on Monday. */
  periodStart: z.iso.date(),
  /** Inclusive last day; defaults to six days after the start. */
  periodEnd: z.iso.date().optional(),
});
export type GenerateSettlementsInput = z.infer<typeof generateSettlementsSchema>;

/** Marking a statement paid: the bank transfer reference, for the trail. */
export const settlementPaidSchema = z.strictObject({
  reference: z.string().trim().max(80).optional(),
});
export type SettlementPaidInput = z.infer<typeof settlementPaidSchema>;

// Restaurant menu management (T07-T10, RES-08 to RES-10) and approvals (A15, ADM-12)

export const itemStockSchema = z.strictObject({ soldOut: z.boolean() });

/** A change to a live item; goes live once Oyo Eats approves it. */
export const menuEditRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    priceCents: z.int().min(100).max(10_000_000).optional(),
    categoryId: z.uuid().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one thing');

export const restaurantCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
});

/** A special closure or special hours on one date (holiday, Poya day). */
export const hoursOverrideSchema = z
  .strictObject({
    date: z.iso.date(),
    closed: z.boolean(),
    opensAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    closesAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .refine(
    (v) => v.closed || (v.opensAt && v.closesAt),
    'Give the special hours, or mark it closed',
  );

export const menuReviewSchema = z
  .strictObject({
    approve: z.boolean(),
    /** Required when rejecting; the restaurant sees it. */
    note: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.approve || v.note, 'Say why it was rejected');

export type MenuEditRequestInput = z.infer<typeof menuEditRequestSchema>;
export type HoursOverrideInput = z.infer<typeof hoursOverrideSchema>;
export type MenuReviewInput = z.infer<typeof menuReviewSchema>;
export type StoreStatusInput = z.infer<typeof storeStatusSchema>;

/** An Expo push token from expo-notifications. */
export const pushTokenSchema = z.strictObject({
  token: z.string().regex(/^Expo(nent)?PushToken\[[\w-]+\]$/, 'Not an Expo push token'),
  platform: z.enum(['ios', 'android']).optional(),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

/** A20 / ADM-18: everything the owner can change without a release. Applies to new orders. */
export const adminSettingsSchema = z.strictObject({
  deliveryFee: z.strictObject({
    baseFeeCents: z.int().min(0).max(200_000),
    perKmCents: z.int().min(0).max(50_000),
    maxRadiusMeters: z.int().min(1_000).max(30_000),
  }),
  timers: z.strictObject({
    restaurantResponseSeconds: z.int().min(60).max(1_800),
    slipWindowSeconds: z.int().min(300).max(7_200),
    offerSeconds: z.int().min(15).max(300),
    unassignedAlertSeconds: z.int().min(60).max(3_600),
    itemChangeSeconds: z.int().min(60).max(900),
  }),
  riderCaps: z.strictObject({
    maxActiveJobs: z.int().min(1).max(5),
    cashCapCents: z.int().min(100_000).max(10_000_000),
  }),
  riderPay: z.strictObject({ platformShareBps: z.int().min(0).max(5_000) }),
  /** Null: no minimum / no limit / dispatchers can't refund without the owner. */
  minimumOrderCents: z.int().min(0).max(10_000_000).nullable(),
  codLimitCents: z.int().min(0).max(50_000_000).nullable(),
  dispatcherRefundCapCents: z.int().min(0).max(10_000_000).nullable(),
  bankDetails: z
    .strictObject({
      bankName: z.string().trim().min(2).max(60),
      branch: z.string().trim().min(2).max(60),
      accountName: z.string().trim().min(2).max(80),
      accountNumber: z.string().trim().min(4).max(30),
    })
    .nullable(),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

// Support and refunds (CUS-14, CUS-19, RID-13, ADM-16)

export const cancelRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(300),
});

/** Multipart fields with the problem report; photos come as files named "photos". */
export const problemReportSchema = z.strictObject({
  type: z.enum(['missing_item', 'wrong_item', 'cold_food', 'late', 'rider_issue', 'other']),
  description: z.string().trim().min(3).max(1000),
});

export const riderIssueSchema = z.strictObject({
  type: z.enum([
    'customer_unreachable',
    'restaurant_closed',
    'wrong_address',
    'vehicle_problem',
    'accident',
    'emergency',
  ]),
  description: z.string().trim().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const refundSchema = z.strictObject({
  amountCents: z.int().min(100).max(100_000_000),
  reasonCode: z.enum([
    'missing_item',
    'wrong_item',
    'cold_food',
    'late_delivery',
    'cancelled_after_accept',
    'cancelled_paid_transfer',
    'goodwill',
  ]),
  attribution: z.enum(['restaurant', 'rider', 'oyo']),
  note: z.string().trim().max(300).optional(),
});

export const resolveCaseSchema = z.strictObject({
  resolution: z.string().trim().min(3).max(500),
});

export const refundPaidSchema = z.strictObject({
  reference: z.string().trim().max(80).optional(),
});

export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;
export type ProblemReportInput = z.infer<typeof problemReportSchema>;
export type RiderIssueInput = z.infer<typeof riderIssueSchema>;
export type RefundInput = z.infer<typeof refundSchema>;

export const reviewReplySchema = z.strictObject({ reply: z.string().trim().min(2).max(500) });

/** YYYY-MM-DD, inclusive, Asia/Colombo; at most 31 days. */
export const historyQuerySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});

/** RES-01: a restaurant owner adding a kitchen login for their own restaurant. */
export const restaurantStaffSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/)
    .optional(),
  phone: sriLankanMobileSchema.optional(),
});
export const reviewHiddenSchema = z.strictObject({ hidden: z.boolean() });

export const customerFlagSchema = z.strictObject({
  note: z.string().trim().min(3).max(300).nullable(),
});
export const customerCodSchema = z.strictObject({ allowed: z.boolean() });
export const customerBlockSchema = z.strictObject({
  blocked: z.boolean(),
  reason: z.string().trim().min(3).max(300).optional(),
});

/** Inclusive, Asia/Colombo; at most 92 days. */
export const reportQuerySchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() });

/** RID-14: who to tell if the rider presses Emergency. */
export const emergencyContactSchema = z.strictObject({
  name: z.string().trim().min(2).max(60),
  phone: sriLankanMobileSchema,
});
