import { describe, expect, it } from 'vitest';
import { assertCents, formatLkr, rupees, sumCents } from './money.js';

describe('money', () => {
  it('converts rupees to integer cents', () => {
    expect(rupees(150)).toBe(15_000);
    expect(rupees(1.1)).toBe(110);
    expect(rupees(0)).toBe(0);
  });

  it('rejects fractions of a cent and non-finite values', () => {
    expect(() => rupees(12.345)).toThrow(RangeError);
    expect(() => rupees(Number.NaN)).toThrow(RangeError);
    expect(() => rupees(Infinity)).toThrow(RangeError);
  });

  it('rejects non-integer cents', () => {
    expect(() => assertCents(10.5)).toThrow(RangeError);
    expect(() => sumCents([100, 0.5])).toThrow(RangeError);
  });

  it('sums cents', () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([135_000, 120_000, 26_000])).toBe(281_000);
  });

  it('formats LKR like the design', () => {
    expect(formatLkr(26_000)).toBe('LKR 260');
    expect(formatLkr(135_000)).toBe('LKR 1,350');
    expect(formatLkr(123_456_700)).toBe('LKR 1,234,567');
    expect(formatLkr(135_050)).toBe('LKR 1,350.50');
    expect(formatLkr(5)).toBe('LKR 0.05');
    expect(formatLkr(0)).toBe('LKR 0');
    expect(formatLkr(-26_000)).toBe('-LKR 260');
  });
});
