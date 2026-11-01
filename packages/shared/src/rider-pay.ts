import type { Cents } from './money.js';
import type { RiderPaySettings } from './settings.js';

/**
 * Pay for one delivery, fixed when the offer is made (section 5): the order's delivery fee less
 * the platform's share (decision 4: 10%), rounded to the rupee, half up.
 */
export function riderPayout(deliveryFeeCents: Cents, pay: RiderPaySettings): Cents {
  const keptBps = 10_000 - pay.platformShareBps;
  return Math.floor((deliveryFeeCents * keptBps + 500_000) / 1_000_000) * 100;
}

/** Riders are offline after this many offers in a row time out (RID-04). */
export const MAX_CONSECUTIVE_MISSES = 3;

export const DECLINE_REASONS = ['too_far', 'vehicle_issue', 'on_break', 'other'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
