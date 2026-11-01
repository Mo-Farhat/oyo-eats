/** Every failure the API can return, with its HTTP status. The code goes to the client. */
const STATUS = {
  not_found: 404,
  username_taken: 409,
  not_ready_to_go_live: 409,
  invalid_input: 400,
  locked: 409,
  rider_not_eligible: 409,
  rider_busy: 409,
  offer_expired: 409,
  cash_required: 400,
  variance_reason_required: 400,
  rating_closed: 409,
  phone_taken: 409,
  phone_unchanged: 400,
  account_busy: 409,
  slip_invalid: 400,
  slip_pending: 409,
  slip_duplicate: 409,
  slip_window_closed: 409,
  invalid_transition: 409,
  restaurant_closed: 409,
  out_of_range: 409,
  item_unavailable: 409,
  modifier_invalid: 400,
  minimum_order: 409,
  payment_method_unavailable: 409,
  too_many_open_orders: 409,
  too_many_unpaid_transfers: 409,
  forbidden: 403,
  rate_limited: 429,
  idempotency_key_required: 400,
  idempotency_key_reused: 422,
  idempotency_in_progress: 409,
  otp_resend_too_soon: 429,
  otp_rate_limited: 429,
  otp_locked: 429,
  otp_invalid: 400,
  otp_expired: 400,
  terms_required: 400,
  invalid_credentials: 401,
  account_locked: 423,
  account_disabled: 403,
  device_required: 400,
  device_pending_approval: 403,
  device_revoked: 403,
  totp_required: 401,
  totp_invalid: 401,
  totp_not_started: 400,
  invalid_token: 401,
  setup_required: 403,
  password_incorrect: 400,
  password_reused: 400,
  password_breached: 400,
} as const;

export type ApiErrorCode = keyof typeof STATUS;

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.status = STATUS[code];
  }
}

/** Lets a transaction commit its bookkeeping (attempt counters, revocations) and still fail. */
export type Outcome<T> = { ok: T } | { error: ApiError };

export function unwrap<T>(outcome: Outcome<T>): T {
  if ('error' in outcome) throw outcome.error;
  return outcome.ok;
}

export function secondsUntil(when: Date, now: Date): number {
  return Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 1000));
}
