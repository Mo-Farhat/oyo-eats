import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto';

/** Keyed hash for lookups (phone numbers) and short secrets (OTP codes). Hex. */
export function hmac(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** Plain SHA-256, for high-entropy random tokens. Hex. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 256-bit random token, base64url. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Uniformly random 6-digit code. */
export function randomOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const VERSION = 1;

/**
 * AES-256-GCM. Layout: version (1 byte) | iv (12) | auth tag (16) | ciphertext.
 * The version byte leaves room for key rotation (SEC-15).
 */
export function encrypt(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decrypt(key: Buffer, data: Buffer): string {
  if (data[0] !== VERSION) throw new Error(`Unknown ciphertext version ${data[0]}`);
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  return Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8');
}
