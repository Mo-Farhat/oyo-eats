/*
 * Support cases and refunds (CUS-14, CUS-19, RID-13, RID-14, ADM-16; PRD section 9).
 */

export const CUSTOMER_PROBLEMS = [
  'missing_item',
  'wrong_item',
  'cold_food',
  'late',
  'rider_issue',
  'other',
] as const;

export const RIDER_ISSUES = [
  'customer_unreachable',
  'restaurant_closed',
  'wrong_address',
  'vehicle_problem',
  'accident',
  'emergency',
] as const;

export const CASE_TYPES = [
  ...CUSTOMER_PROBLEMS,
  ...RIDER_ISSUES,
  'cancel_request',
  'refund_bank_transfer',
  'office',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_LABELS: Record<CaseType, string> = {
  missing_item: 'Missing item',
  wrong_item: 'Wrong item',
  cold_food: 'Cold food',
  late: 'Late delivery',
  rider_issue: 'Rider issue',
  other: 'Other problem',
  customer_unreachable: 'Customer unreachable',
  restaurant_closed: 'Restaurant closed',
  wrong_address: 'Wrong address',
  vehicle_problem: 'Vehicle problem',
  accident: 'Accident',
  emergency: 'Emergency',
  cancel_request: 'Cancel request',
  refund_bank_transfer: 'Refund bank transfer',
  office: 'Office case',
};

/** Rider reports that ring as critical for every dispatcher. */
export const URGENT_CASES: readonly CaseType[] = ['emergency', 'accident'];

/** Every refund needs a reason code (PRD section 7, manual overrides). */
export const REFUND_REASONS = [
  'missing_item',
  'wrong_item',
  'cold_food',
  'late_delivery',
  'cancelled_after_accept',
  'cancelled_paid_transfer',
  'goodwill',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Office reasons, plus `item_unavailable`, which only the kitchen's item change raises (RES-05). */
export const REFUND_REASON_LABELS: Record<RefundReason | 'item_unavailable', string> = {
  missing_item: 'Missing item',
  wrong_item: 'Wrong item',
  cold_food: 'Cold food',
  late_delivery: 'Late delivery',
  cancelled_after_accept: 'Cancelled after accept',
  cancelled_paid_transfer: 'Cancelled, transfer paid',
  goodwill: 'Goodwill',
  item_unavailable: 'Item unavailable',
};

/** Who bears the refund: it comes off their next statement, or Oyo Eats absorbs it. */
export const REFUND_ATTRIBUTIONS = ['restaurant', 'rider', 'oyo'] as const;
export type RefundAttribution = (typeof REFUND_ATTRIBUTIONS)[number];

/**
 * How much can still be refunded: what the customer actually paid, less refunds so far. Cash
 * orders count only once the cash was collected; bank transfers once the money arrived.
 */
export function refundable(o: { paidCents: number; refundedCents: number }): number {
  return Math.max(0, o.paidCents - o.refundedCents);
}

/** Dispatchers refund up to the cap (ADM-16); above it, or with no cap set, only the owner. */
export function needsOwner(amountCents: number, capCents: number | undefined): boolean {
  return capCents === undefined || amountCents > capCents;
}
