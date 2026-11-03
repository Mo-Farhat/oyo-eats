import { OFFICE_PHONE } from '@/config';
import { ApiRequestError } from './client';

function minutes(seconds: unknown): string {
  const m = Math.ceil(Number(seconds ?? 60) / 60);
  return m <= 1 ? '1 minute' : `${m} minutes`;
}

/** Plain-language message for an API error code. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Something went wrong. Please try again.';
  const b = error.body;
  switch (error.code) {
    case 'network_error':
      return "Can't reach Oyo Eats. Check your connection and try again.";
    case 'validation_failed':
      return b.issues?.[0]?.message ?? 'Please check what you entered.';
    case 'otp_invalid':
      return b.attemptsLeft
        ? `Wrong code. ${b.attemptsLeft} ${b.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That code has expired. Ask for a new one.';
    case 'otp_expired':
      return 'That code has expired. Ask for a new one.';
    case 'otp_locked':
      return `Too many wrong codes. Try again in ${minutes(b.retryAfterSeconds)}.`;
    case 'otp_resend_too_soon':
      return `Wait ${b.retryAfterSeconds ?? 30} seconds before asking for another code.`;
    case 'otp_rate_limited':
    case 'rate_limited':
      return `Too many attempts. Try again in ${minutes(b.retryAfterSeconds)}.`;
    case 'invalid_credentials':
      return 'Wrong username or password.';
    case 'account_locked':
      return `Too many wrong passwords. Try again in ${minutes(b.retryAfterSeconds)}.`;
    case 'account_disabled':
      return `This account is switched off. Call the Oyo Eats office on ${OFFICE_PHONE.display}.`;
    case 'device_pending_approval':
      return `This phone is new for your account. The Oyo Eats office has to approve it before you can sign in. Call ${OFFICE_PHONE.display}.`;
    case 'device_revoked':
      return `This phone has been removed from your account. Call the Oyo Eats office on ${OFFICE_PHONE.display}.`;
    case 'totp_invalid':
      return 'That code is wrong or already used. Wait for the next code and try again.';
    case 'password_incorrect':
      return 'Your temporary password is wrong.';
    case 'password_reused':
      return 'Choose a password different from the temporary one.';
    case 'password_breached':
      return 'That password has appeared in a data breach. Choose a different one.';
    case 'not_found':
      return "We couldn't find that. It may have been removed.";
    case 'restaurant_closed':
      return 'This restaurant has just closed. Try again when it reopens.';
    case 'out_of_range':
      return 'This address is too far from the restaurant for delivery.';
    case 'item_unavailable':
      return 'Something in your cart is no longer available. Remove it and try again.';
    case 'modifier_invalid':
      return 'Some options for an item need changing. Remove it and add it again.';
    case 'minimum_order':
      return 'Your order is below the minimum for delivery.';
    case 'payment_method_unavailable':
      return "That payment method isn't available for this order. Choose another.";
    case 'too_many_open_orders':
      return 'You already have 3 orders on the way. Wait for one to finish first.';
    case 'too_many_unpaid_transfers':
      return 'You have 2 bank transfers waiting. Upload those slips before ordering again.';
    case 'slip_invalid':
      return b.issues
        ? 'Please check the slip.'
        : 'That file isn’t a photo we can read. Use a JPG or PNG photo of the slip, under 10 MB.';
    case 'slip_pending':
      return 'Your slip is already being checked. We’ll let you know shortly.';
    case 'slip_duplicate':
      return 'This slip has already been used for another order. Upload the slip for this payment.';
    case 'slip_window_closed':
      return 'The time to upload a slip has passed, so this order was cancelled. You can order again.';
    case 'rating_closed':
      return 'Ratings can only be given or changed within 24 hours of delivery.';
    case 'phone_taken':
      return 'That number already belongs to another Oyo Eats account.';
    case 'phone_unchanged':
      return 'That is already your number.';
    case 'account_busy':
      return 'You have an order in progress. You can delete your account once it is finished.';
    case 'locked':
      return `${b.by ?? 'Another dispatcher'} is assigning this order right now. Try again in a few seconds.`;
    case 'rider_not_eligible':
      return 'That rider can’t take this order now (offline, at a cap, or already declined it).';
    case 'rider_busy':
      return 'Finish your current job before going offline.';
    case 'offer_expired':
      return 'This offer has expired and gone back to dispatch.';
    case 'cash_required':
      return 'Enter the cash you collected.';
    case 'variance_reason_required':
      return 'The cash is different from the total. Say why before completing.';
    case 'invalid_transition':
      return 'This order has moved on and can no longer be changed here.';
    case 'username_taken':
      return 'That username is taken. Choose another or leave it blank.';
    case 'not_ready_to_go_live':
      return `Not ready to go live: ${(b.blockers ?? []).join('; ')}.`;
    case 'forbidden':
      return 'Your role can’t do that. Ask the owner.';
    case 'invalid_input':
      return 'Please check what you entered.';
    case 'refund_over_cap':
      return b.capCents
        ? `That's over your refund limit. Ask the owner to refund it.`
        : 'Refunds need the owner until a dispatcher refund limit is set in Settings.';
    case 'refund_too_large':
      return 'That’s more than is left to refund on this order.';
    case 'case_open':
      return 'You’ve already sent this request. The Oyo Eats office will get back to you.';
    case 'photo_invalid':
      return 'Use up to 3 photos (JPG or PNG, under 10 MB each).';
    case 'idempotency_in_progress':
      return 'Still placing your order. Please wait a moment.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
