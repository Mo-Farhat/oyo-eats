import { describe, expect, it } from 'vitest';
import { CASE_LABELS, CASE_TYPES, needsOwner, refundable } from './support.js';

describe('support rules', () => {
  it('refunds at most what was paid, less earlier refunds', () => {
    expect(refundable({ paidCents: 150_000, refundedCents: 0 })).toBe(150_000);
    expect(refundable({ paidCents: 150_000, refundedCents: 120_000 })).toBe(30_000);
    expect(refundable({ paidCents: 0, refundedCents: 0 })).toBe(0);
    expect(refundable({ paidCents: 10_000, refundedCents: 20_000 })).toBe(0);
  });

  it('sends refunds over the cap, or with no cap, to the owner', () => {
    expect(needsOwner(50_000, 100_000)).toBe(false);
    expect(needsOwner(100_000, 100_000)).toBe(false);
    expect(needsOwner(100_100, 100_000)).toBe(true);
    expect(needsOwner(1, undefined)).toBe(true);
  });

  it('has a label for every case type', () => {
    for (const t of CASE_TYPES) expect(CASE_LABELS[t]).toBeTruthy();
  });
});
