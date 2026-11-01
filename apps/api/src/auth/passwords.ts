import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';

// Argon2id with the OWASP-recommended baseline (19 MiB, 2 passes, 1 lane). SEC-02.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

/** A real hash to verify against when the username doesn't exist, so timing doesn't leak it. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verify(await dummyHash, password);
}

export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<boolean>;
}

/**
 * Have I Been Pwned range API (k-anonymity: only the first 5 hex chars of the SHA-1 leave the
 * server). Fails open with a warning if the service is unreachable, so an outage can't block
 * staff from setting passwords.
 */
export class PwnedPasswordsChecker implements BreachedPasswordChecker {
  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      return body.split('\n').some((line) => {
        const [lineSuffix, count] = line.trim().split(':');
        return lineSuffix === suffix && Number(count) > 0;
      });
    } catch (error) {
      console.warn(`Breached-password check unavailable, allowing: ${String(error)}`);
      return false;
    }
  }
}
