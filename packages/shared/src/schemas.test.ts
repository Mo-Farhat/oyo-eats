import { describe, expect, it } from 'vitest';
import { normalizeSriLankanMobile, placeOrderSchema, verifyOtpSchema } from './schemas.js';

describe('normalizeSriLankanMobile', () => {
  it.each([
    '0771234567',
    '771234567',
    '94771234567',
    '+94771234567',
    '+94 77 123 4567',
    '077-123-4567',
    '0094771234567',
  ])('accepts %s', (input) => {
    expect(normalizeSriLankanMobile(input)).toBe('+94771234567');
  });

  it.each([
    '0701234567',
    '0711234567',
    '0721234567',
    '0741234567',
    '0751234567',
    '0761234567',
    '0781234567',
  ])('accepts prefix %s', (input) => {
    expect(normalizeSriLankanMobile(input)).not.toBeNull();
  });

  it.each([
    '0731234567',
    '0791234567',
    '0112345678',
    '077123456',
    '07712345678',
    '+44771234567',
    'abc',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeSriLankanMobile(input)).toBeNull();
  });
});

describe('verifyOtpSchema', () => {
  it('normalizes the phone and requires 6 digits', () => {
    expect(verifyOtpSchema.parse({ phone: '0771234567', code: '123456' })).toEqual({
      phone: '+94771234567',
      code: '123456',
    });
    expect(verifyOtpSchema.safeParse({ phone: '0771234567', code: '12345' }).success).toBe(false);
  });
});

describe('placeOrderSchema', () => {
  const valid = {
    restaurantId: '0b6a1c1e-3f4b-4d6a-9b1a-2c3d4e5f6a7b',
    addressId: '1c7b2d2f-4a5c-4e7b-8c2b-3d4e5f6a7b8c',
    paymentMethod: 'cod',
    items: [{ menuItemId: '2d8c3e3a-5b6d-4f8c-9d3c-4e5f6a7b8c9d', quantity: 2 }],
  };

  it('accepts ids and quantities and defaults modifiers', () => {
    expect(placeOrderSchema.parse(valid).items[0]?.modifierIds).toEqual([]);
  });

  it('rejects client-supplied prices or totals', () => {
    expect(placeOrderSchema.safeParse({ ...valid, totalCents: 1 }).success).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...valid, items: [{ ...valid.items[0], priceCents: 1 }] })
        .success,
    ).toBe(false);
  });

  it('rejects empty carts, bad quantities and unknown payment methods', () => {
    expect(placeOrderSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...valid, items: [{ ...valid.items[0], quantity: 0 }] }).success,
    ).toBe(false);
    expect(placeOrderSchema.safeParse({ ...valid, paymentMethod: 'crypto' }).success).toBe(false);
  });
});
