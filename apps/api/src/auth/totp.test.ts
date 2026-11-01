import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpAt, verifyTotp } from './totp.js';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (8-digit codes, last 6 used here).
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector at t=%i', (seconds, code) => {
    expect(totpAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
    expect(totpAt(RFC_SECRET, Math.floor(seconds / 30), 8).slice(-6)).toBe(code);
  });

  it('round-trips base32', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toEqual(RFC_SECRET);
  });

  it('accepts one step of drift and refuses replays', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = new Date(1111111111 * 1000);
    const step = Math.floor(1111111111 / 30);
    const previous = totpAt(RFC_SECRET, step - 1);
    expect(verifyTotp(secret, previous, now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, previous, now, step - 1)).toBeNull();
    expect(verifyTotp(secret, 'abc123', now, null)).toBeNull();
  });
});
