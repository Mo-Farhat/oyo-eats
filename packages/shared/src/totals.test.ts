import { describe, expect, it } from 'vitest';
import { lineTotal, orderTotals } from './totals.js';

describe('order totals', () => {
  it('prices a line with modifiers and quantity', () => {
    expect(
      lineTotal({ unitPriceCents: 135_000, modifierPriceCents: [15_000, 5_000], quantity: 2 }),
    ).toBe(310_000);
  });

  it('adds items, delivery fee and restaurant fee', () => {
    expect(
      orderTotals({
        lines: [
          { unitPriceCents: 135_000, modifierPriceCents: [], quantity: 1 },
          { unitPriceCents: 120_000, modifierPriceCents: [], quantity: 1 },
        ],
        deliveryFeeCents: 26_000,
      }),
    ).toEqual({
      itemsCents: 255_000,
      deliveryFeeCents: 26_000,
      restaurantFeeCents: 0,
      totalCents: 281_000,
    });
  });

  it('rejects empty orders and bad quantities', () => {
    expect(() => orderTotals({ lines: [], deliveryFeeCents: 0 })).toThrow(RangeError);
    expect(() => lineTotal({ unitPriceCents: 100, modifierPriceCents: [], quantity: 0 })).toThrow(
      RangeError,
    );
    expect(() => lineTotal({ unitPriceCents: 100, modifierPriceCents: [], quantity: 1.5 })).toThrow(
      RangeError,
    );
  });
});
