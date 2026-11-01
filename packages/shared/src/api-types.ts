import type {
  CustomerStage,
  DeliveryStatus,
  KitchenStatus,
  OrderStatus,
  PaymentMethod,
} from './order-state.js';
import type { Role } from './roles.js';

/*
 * JSON shapes of API responses, shared by the API and the app. Dates arrive as ISO strings.
 * Errors are always `{ error: code, ...details }` with a matching HTTP status.
 */

export type SetupStep = 'change_password' | 'enroll_totp';

export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface SignInResponse {
  tokens: TokensResponse;
  account: { id: string; role: Role; displayName: string; tenantId: string | null };
  /** Non-empty: a limited session that must finish these steps first. */
  setup: SetupStep[];
}

export interface MeResponse {
  accountId: string;
  role: Role;
  tenantId: string | null;
  limited: boolean;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
}

export interface ApiErrorBody {
  error: string;
  retryAfterSeconds?: number;
  attemptsLeft?: number;
  issues?: { path: string; message: string }[];
  /** locked: who holds the assignment lock. */
  by?: string;
  reasons?: string[];
  /** not_ready_to_go_live: what still has to be done. */
  blockers?: string[];
}

// Customer: catalog, addresses, orders

export interface AddressResponse {
  id: string;
  label: string;
  lat: number;
  lng: number;
  addressText: string;
  note: string | null;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  cuisines: string[];
  addressText: string;
  isOpen: boolean;
  rating: number | null;
  ratingCount: number;
  /** Road distance, the same one the delivery fee uses. */
  distanceMeters: number;
  deliveryFeeCents: number;
  eta: { min: number; max: number };
}

export interface ModifierOption {
  id: string;
  name: string;
  priceCents: number;
  soldOut: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  photoUrl: string | null;
  dietaryTags: string[];
  soldOut: boolean;
  groups: ModifierGroup[];
}

export interface RestaurantDetail extends Omit<
  RestaurantSummary,
  'distanceMeters' | 'deliveryFeeCents' | 'eta'
> {
  /** Present when the request gave a location. */
  distanceMeters: number | null;
  deliveryFeeCents: number | null;
  eta: { min: number; max: number } | null;
  categories: { id: string; name: string; items: MenuItem[] }[];
}

export interface PricedLineResponse {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: { id: string; name: string; priceCents: number }[];
  lineTotalCents: number;
  note: string | null;
}

export interface QuoteResponse {
  restaurantId: string;
  lines: PricedLineResponse[];
  itemsCents: number;
  deliveryFeeCents: number;
  restaurantFeeCents: number;
  totalCents: number;
  routeMeters: number;
  /** The fee formula in force, for the breakdown line ("LKR 150 base + 2.0 km x LKR 55"). */
  baseFeeCents: number;
  perKmCents: number;
  eta: { min: number; max: number };
  /** Payment methods this order may use (CUS-08). */
  paymentMethods: PaymentMethod[];
}

export interface OrderSummary {
  id: string;
  reference: string;
  restaurant: { id: string; name: string };
  status: OrderStatus;
  stage: CustomerStage | null;
  paymentMethod: PaymentMethod;
  totalCents: number;
  itemCount: number;
  placedAt: string;
  /** The customer's restaurant rating, once given. */
  myRating: number | null;
  /** Delivered, and inside the 24-hour rating window. */
  canRate: boolean;
}

export interface OrderDetail extends OrderSummary {
  kitchenStatus: KitchenStatus | null;
  deliveryStatus: DeliveryStatus | null;
  lines: PricedLineResponse[];
  itemsCents: number;
  deliveryFeeCents: number;
  restaurantFeeCents: number;
  deliveryAddress: { addressText: string | null; note: string | null; lat: number; lng: number };
  prepMinutes: number | null;
  /** Rebuilt from order events (CUS-11). */
  timeline: { type: string; at: string }[];
  canCancel: boolean;
  /** Present for bank-transfer orders (CUS-09). */
  bankTransfer: BankTransferInfo | null;
  /**
   * The assigned rider (CUS-12). Null until a rider accepts. `phone` is there only while the
   * delivery is open, so the customer can call (canSeeRiderContact).
   */
  rider: {
    name: string;
    vehicle: string | null;
    plate: string | null;
    phone: string | null;
  } | null;
  ratings: OrderRatings;
  /** End of the rating edit window, once delivered. */
  rateUntil: string | null;
  /** When the restaurant promised the food ready (accept time + prep time). */
  readyBy: string | null;
}

export interface OrderRatings {
  restaurant: { rating: number; tags: string[]; body: string | null } | null;
  rider: { rating: number; tags: string[] } | null;
}

/** A review on a restaurant page (CUS-20): only verified delivered orders, hidden ones left out. */
export interface ReviewResponse {
  rating: number;
  tags: string[];
  body: string | null;
  /** First name only. */
  author: string;
  createdAt: string;
  reply: string | null;
}

export interface ProfileResponse {
  displayName: string;
  phone: string;
  marketingOptIn: boolean;
  /** Account deletion is blocked while an order is open. */
  hasOpenOrders: boolean;
}

export interface BankDetails {
  bankName: string;
  branch: string;
  accountName: string;
  accountNumber: string;
}

export type SlipStatus = 'pending' | 'approved' | 'rejected' | 'resubmit_requested';

export interface BankTransferInfo {
  /** Null until the business sets its account (docs/NEEDS-YOU.md). */
  bankDetails: BankDetails | null;
  /** Put this in the transfer remark. */
  reference: string;
  amountCents: number;
  /** Upload deadline (slip window). */
  expiresAt: string;
  slip: { status: SlipStatus; uploadedAt: string; reviewReason: string | null } | null;
  canUpload: boolean;
}

/** A slip waiting for review in the admin queue (A12). */
export interface SlipReviewItem {
  slipId: string;
  orderId: string;
  reference: string;
  restaurantName: string;
  amountCents: number;
  declaredAmountCents: number | null;
  bankReference: string | null;
  uploadedAt: string;
  expiresAt: string;
  /** Short-lived signed link to the image. */
  imageUrl: string;
}

// Restaurant face (T01-T06)

export interface RestaurantOrder {
  id: string;
  reference: string;
  /** First name only; restaurants never see the phone or address (section 6). */
  customerFirstName: string;
  status: OrderStatus;
  kitchenStatus: KitchenStatus | null;
  deliveryStatus: DeliveryStatus | null;
  paymentMethod: PaymentMethod;
  /** COD is collected by the rider; anything else is already paid. */
  paid: boolean;
  lines: {
    menuItemId: string;
    name: string;
    quantity: number;
    modifiers: string[];
    note: string | null;
    lineTotalCents: number;
  }[];
  itemCount: number;
  /** Food total: what the restaurant prepares (delivery fee is not theirs). */
  itemsCents: number;
  placedAt: string;
  /** New orders: auto-reject time (RES-04). */
  respondBy: string | null;
  acceptedAt: string | null;
  prepMinutes: number | null;
  readyBy: string | null;
  readyAt: string | null;
  rider: { name: string; vehicle: string; plate: string } | null;
}

export interface RestaurantBoard {
  restaurant: { id: string; name: string; open: boolean };
  new: RestaurantOrder[];
  preparing: RestaurantOrder[];
  ready: RestaurantOrder[];
  /** Picked up, delivered or closed today (Asia/Colombo). */
  done: RestaurantOrder[];
}

// Dispatch (A01-A06)

export interface DispatchOrder {
  id: string;
  reference: string;
  restaurant: { id: string; name: string };
  customerFirstName: string;
  status: OrderStatus;
  kitchenStatus: KitchenStatus | null;
  deliveryStatus: DeliveryStatus | null;
  paymentMethod: PaymentMethod;
  totalCents: number;
  itemCount: number;
  placedAt: string;
  acceptedAt: string | null;
  readyBy: string | null;
  /** Unassigned since the restaurant accepted, past the alert timer (ADM-01). */
  late: boolean;
  rider: { id: string; name: string } | null;
  offer: { id: string; riderId: string; riderName: string; expiresAt: string } | null;
}

export interface DispatchBoard {
  awaitingRestaurant: DispatchOrder[];
  /** Accepted and without a rider (or with an offer out). */
  unassigned: DispatchOrder[];
  /** A rider has it; not picked up yet. */
  assigned: DispatchOrder[];
  outForDelivery: DispatchOrder[];
  doneToday: DispatchOrder[];
}

export interface CandidateRider {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
  online: boolean;
  activeJobs: number;
  cashHeldCents: number;
  /** Straight-line distance to the restaurant from the last known position. */
  distanceMeters: number | null;
  lastSeenAt: string | null;
  eligible: boolean;
  reasons: string[];
}

export interface AssignmentLock {
  orderId: string;
  /** Held by the caller until this time (30 s, ADM rule). */
  expiresAt: string;
}

// Rider (R01-R08)

export interface RiderOffer {
  id: string;
  orderId: string;
  reference: string;
  restaurant: { name: string; address: string };
  /** Area only before accepting (RID-03): distance from the restaurant to the drop-off. */
  dropoffDistanceMeters: number;
  itemCount: number;
  /** Cash to collect at the door (COD), 0 when prepaid. */
  collectCents: number;
  payoutCents: number;
  expiresAt: string;
}

export interface RiderJob {
  orderId: string;
  reference: string;
  status: OrderStatus;
  kitchenStatus: KitchenStatus | null;
  restaurant: { name: string; address: string; lat: number; lng: number };
  /** Revealed after accepting, removed at close (SEC-12). */
  customer: {
    firstName: string;
    phone: string | null;
    address: string | null;
    note: string | null;
    lat: number;
    lng: number;
  };
  itemCount: number;
  paymentMethod: PaymentMethod;
  /** Cash to collect at the door (COD). */
  collectCents: number;
  payoutCents: number;
}

export interface RiderState {
  online: boolean;
  paused: boolean;
  consecutiveMisses: number;
  cashHeldCents: number;
  /** From settings: at or above this, no cash orders are offered (RID-12). */
  cashCapCents: number;
  /** Recent handovers to the office, newest first (RID-12). */
  handovers: CashHandoverRecord[];
  offer: RiderOffer | null;
  jobs: RiderJob[];
}

// Admin onboarding (A08-A10, A13, A14)

export interface CreatedAccount {
  accountId: string;
  username: string;
  /** Shown once (ADM-08); the user must change it at first sign-in. */
  temporaryPassword: string;
}

export interface StaffAccount {
  id: string;
  role: Role;
  displayName: string;
  username: string | null;
  active: boolean;
  tenantId: string | null;
  createdAt: string;
  /** Devices waiting for approval (SEC-06). */
  pendingDevices: { id: string; deviceId: string; platform: string | null; firstSeenAt: string }[];
}

export interface AdminRestaurantSummary {
  id: string;
  name: string;
  status: 'onboarding' | 'active' | 'suspended';
  addressText: string;
  isOpen: boolean;
  ordersToday: number;
  licenceExpiresOn: string | null;
}

export interface AdminRestaurantDetail extends AdminRestaurantSummary {
  lat: number;
  lng: number;
  cuisines: string[];
  prepMinutes: number;
  licenceNumber: string | null;
  bankDetails: BankDetails | null;
  weekly: { weekday: number; opensAt: string; closesAt: string }[];
  users: StaffAccount[];
  menu: {
    id: string;
    name: string;
    sortOrder: number;
    items: (MenuItem & { archived: boolean })[];
  }[];
  /** What still blocks going live. Empty means it can be activated. */
  goLiveBlockers: string[];
}

/** A02: everything dispatch needs about one order. */
export interface AdminOrderDetail extends OrderDetail {
  customer: { name: string; phone: string | null };
  /** The timeline with who did what and any reason given. */
  events: { type: string; at: string; actor: string | null; note: string | null }[];
  offers: {
    riderName: string;
    outcome: string;
    reason: string | null;
    payoutCents: number;
    sentAt: string;
  }[];
  canAdminCancel: boolean;
  canMarkFailed: boolean;
}

/** A08: one row in the rider list. */
export interface AdminRiderSummary {
  id: string;
  name: string;
  username: string | null;
  vehicle: string;
  plate: string;
  /** on_job: has an open delivery; suspended: login switched off. */
  status: 'on_job' | 'idle' | 'offline' | 'paused' | 'suspended';
  activeJobs: number;
  cashHeldCents: number;
  cashCapCents: number;
  lastSeenAt: string | null;
  /** Online with no location report for over 2 minutes. */
  noSignal: boolean;
  deliveredToday: number;
  declinedToday: number;
}

export interface CashHandoverRecord {
  id: string;
  amountCents: number;
  expectedCents: number;
  varianceReason: string | null;
  recordedBy: string;
  /** Who signed off a difference (owner). Null when there was no difference or not yet signed. */
  countersignedBy: string | null;
  recordedAt: string;
}

/** A09: one rider in detail. */
export interface AdminRiderDetail extends AdminRiderSummary {
  phone: string | null;
  nicOnFile: boolean;
  rating: number | null;
  ratingCount: number;
  declinedThisWeek: number;
  /** Open jobs, for the board link. */
  jobs: { orderId: string; reference: string; status: string }[];
  /** COD orders delivered since the last handover: what the rider should be carrying. */
  cashOrders: { orderId: string; reference: string; cashCents: number; deliveredAt: string }[];
  handovers: CashHandoverRecord[];
  /** Recent 1-2 star rider ratings with a comment. */
  lowRatings: { rating: number; body: string | null; tags: string[]; at: string }[];
}

/** A16, A17: a restaurant statement or rider payout for one period (ADM-13, ADM-14). */
export interface SettlementSummary {
  id: string;
  party: 'restaurant' | 'rider';
  partyId: string;
  partyName: string;
  /** YYYY-MM-DD, Asia/Colombo, inclusive. */
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  status: 'draft' | 'reviewed' | 'paid';
  lineCount: number;
  createdAt: string;
  paidAt: string | null;
}

export interface SettlementDetail extends SettlementSummary {
  lines: { orderId: string | null; description: string; amountCents: number }[];
  /** Where to pay a restaurant (decrypted for the owner). */
  bankDetails: BankDetails | null;
  /** SHA-256 over the lines, fixed when paid. */
  checksum: string | null;
}
