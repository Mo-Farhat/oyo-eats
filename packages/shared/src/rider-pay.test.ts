import { describe, expect, it } from 'vitest';
import { deliveryFee } from './fees.js';
import { riderPayout } from './rider-pay.js';
import { SETTINGS_SEED_DEFAULTS } from './settings.js';

describe('riderPayout', () => {
  const pay = SETTINGS_SEED_DEFAULTS.riderPay;

  it('is the delivery fee less 10%', () => {
    expect(riderPayout(26_000, pay)).toBe(23_400); // 260 -> 234
    expect(riderPayout(34_800, pay)).toBe(31_300); // 348 -> 313.20 -> 313
    expect(riderPayout(48_000, pay)).toBe(43_200); // 480 -> 432
  });

  it('rounds to the rupee, half up', () => {
    expect(riderPayout(26_500, pay)).toBe(23_900); // 238.50 -> 239
    expect(riderPayout(26_400, pay)).toBe(23_800); // 237.60 -> 238
    expect(riderPayout(26_100, pay)).toBe(23_500); // 234.90 -> 235
  });

  it('never pays more than the fee, at every fee the engine can produce', () => {
    for (let m = 0; m <= 10_000; m += 37) {
      const fee = deliveryFee(m, SETTINGS_SEED_DEFAULTS.deliveryFee);
      const out = riderPayout(fee, pay);
      expect(out % 100).toBe(0);
      expect(out).toBeLessThanOrEqual(fee);
      expect(Math.abs(out - fee * 0.9)).toBeLessThanOrEqual(50);
    }
  });

  it('follows the share setting', () => {
    expect(riderPayout(30_000, { platformShareBps: 0 })).toBe(30_000);
    expect(riderPayout(30_000, { platformShareBps: 2_000 })).toBe(24_000);
  });
});
