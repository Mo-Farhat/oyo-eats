import { describe, expect, it } from 'vitest';
import { deliveryFee, isWithinDeliveryRadius } from './fees.js';
import { SETTINGS_SEED_DEFAULTS } from './settings.js';

const settings = SETTINGS_SEED_DEFAULTS.deliveryFee;

describe('deliveryFee', () => {
  it.each([
    [2_000, 26_000], // PRD check: 2.0 km = 260
    [3_600, 34_800], // PRD check: 3.6 km = 348
    [6_000, 48_000], // PRD check: 6 km = 480
    [0, 15_000],
    [10_000, 70_000],
  ])('%i m costs %i cents', (meters, cents) => {
    expect(deliveryFee(meters, settings)).toBe(cents);
  });

  it('charges part kilometres pro rata, rounded half up to a whole rupee', () => {
    // 150 + 55 * 1.01 = 205.55 -> 206
    expect(deliveryFee(1_010, settings)).toBe(20_600);
    // 150 + 55 * 1.009 = 205.495 -> 205
    expect(deliveryFee(1_009, settings)).toBe(20_500);
    // 100 + 1 * 0.5 = 100.5 -> 101 (exact half rounds up)
    expect(
      deliveryFee(500, { baseFeeCents: 10_000, perKmCents: 100, maxRadiusMeters: 10_000 }),
    ).toBe(10_100);
  });

  it('uses the settings passed in, not fixed rates', () => {
    expect(
      deliveryFee(2_000, { baseFeeCents: 20_000, perKmCents: 6_000, maxRadiusMeters: 10_000 }),
    ).toBe(32_000);
  });

  it('rejects negative or fractional distances', () => {
    expect(() => deliveryFee(-1, settings)).toThrow(RangeError);
    expect(() => deliveryFee(1.5, settings)).toThrow(RangeError);
  });
});

describe('isWithinDeliveryRadius', () => {
  it('includes the boundary and excludes beyond it', () => {
    expect(isWithinDeliveryRadius(10_000, settings)).toBe(true);
    expect(isWithinDeliveryRadius(10_001, settings)).toBe(false);
  });
});
