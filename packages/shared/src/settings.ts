import type { Cents } from './money.js';

/**
 * Business settings (ADM-18). Live values always come from the settings table; these
 * defaults exist only to seed it. Never import them into fee or dispatch logic directly.
 */
export interface DeliveryFeeSettings {
  baseFeeCents: Cents;
  perKmCents: Cents;
  maxRadiusMeters: number;
}

export interface RiderCapSettings {
  maxActiveJobs: number;
  cashCapCents: Cents;
}

/** Rider pay per delivery (decision 4): the delivery fee less the platform's share. */
export interface RiderPaySettings {
  /** Basis points of the delivery fee the platform keeps: 1000 = 10%. */
  platformShareBps: number;
}

export interface TimerSettings {
  restaurantResponseSeconds: number;
  slipWindowSeconds: number;
  offerSeconds: number;
  unassignedAlertSeconds: number;
}

export const SETTINGS_SEED_DEFAULTS = {
  deliveryFee: { baseFeeCents: 15_000, perKmCents: 5_500, maxRadiusMeters: 10_000 },
  riderCaps: { maxActiveJobs: 3, cashCapCents: 1_500_000 },
  // Decided 2026-11-02: the rider gets the delivery fee less 10%.
  riderPay: { platformShareBps: 1_000 },
  timers: {
    restaurantResponseSeconds: 5 * 60,
    slipWindowSeconds: 30 * 60,
    offerSeconds: 60,
    unassignedAlertSeconds: 5 * 60,
  },
} as const satisfies {
  deliveryFee: DeliveryFeeSettings;
  riderCaps: RiderCapSettings;
  riderPay: RiderPaySettings;
  timers: TimerSettings;
};
