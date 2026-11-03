import { describe, expect, it } from 'vitest';
import { applyItemChange, missingPart, substituteAllowed } from './item-changes.js';

// 3 x Chicken Kottu at 900 with a 100 extra-egg modifier: 3,000 for the line.
const line = { quantity: 3, lineTotalCents: 300_000 };

describe('missingPart', () => {
  it('prices the missing quantity with its modifiers', () => {
    expect(missingPart(line, 1)).toEqual({ quantity: 2, cents: 200_000, unitCents: 100_000 });
    expect(missingPart(line, 0)).toEqual({ quantity: 3, cents: 300_000, unitCents: 100_000 });
  });

  it('needs at least one missing and a whole unit price', () => {
    expect(() => missingPart(line, 3)).toThrow(RangeError);
    expect(() => missingPart(line, -1)).toThrow(RangeError);
    expect(() => missingPart({ quantity: 3, lineTotalCents: 100_001 }, 0)).toThrow(RangeError);
  });
});

describe('applyItemChange', () => {
  it('removing keeps what the kitchen can make and takes the rest off the total', () => {
    expect(applyItemChange(line, 1, 'remove', null)).toEqual({
      keep: { quantity: 1, lineTotalCents: 100_000 },
      substitute: null,
      deltaCents: -200_000,
    });
    expect(applyItemChange(line, 0, 'remove', null)).toEqual({
      keep: null,
      substitute: null,
      deltaCents: -300_000,
    });
  });

  it('a cheaper substitute lowers the total, a dearer one raises it', () => {
    expect(applyItemChange(line, 1, 'substitute', 80_000)).toEqual({
      keep: { quantity: 1, lineTotalCents: 100_000 },
      substitute: { quantity: 2, unitPriceCents: 80_000, lineTotalCents: 160_000 },
      deltaCents: -40_000,
    });
    expect(applyItemChange(line, 0, 'substitute', 120_000).deltaCents).toBe(60_000);
  });

  it('a substitute needs an offered price', () => {
    expect(() => applyItemChange(line, 0, 'substitute', null)).toThrow(RangeError);
  });
});

describe('substituteAllowed', () => {
  it('cash orders take any price; prepaid orders only up to what is replaced', () => {
    expect(substituteAllowed('cod', line, 0, 150_000)).toBe(true);
    expect(substituteAllowed('bank_transfer', line, 0, 100_000)).toBe(true);
    expect(substituteAllowed('bank_transfer', line, 0, 100_001)).toBe(false);
    expect(substituteAllowed('bank_transfer', line, 2, 100_000)).toBe(true);
  });
});
