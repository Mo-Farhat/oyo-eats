import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, randomOtp } from './crypto.js';

describe('crypto', () => {
  const key = randomBytes(32);

  it('round-trips encryption with a fresh IV each time', () => {
    const a = encrypt(key, '+94771234567');
    const b = encrypt(key, '+94771234567');
    expect(a.equals(b)).toBe(false);
    expect(decrypt(key, a)).toBe('+94771234567');
  });

  it('rejects tampered ciphertext and the wrong key', () => {
    const data = encrypt(key, 'secret');
    data[data.length - 1]! ^= 1;
    expect(() => decrypt(key, data)).toThrow();
    expect(() => decrypt(randomBytes(32), encrypt(key, 'secret'))).toThrow();
  });

  it('makes 6-digit codes', () => {
    for (let i = 0; i < 100; i++) expect(randomOtp()).toMatch(/^\d{6}$/);
  });
});
