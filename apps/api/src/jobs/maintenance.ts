import { and, isNotNull, lt, or } from 'drizzle-orm';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { idempotencyKeys, otpChallenges, sessions } from '../db/schema.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Hourly housekeeping: expired idempotency keys, OTP challenges older than a day (they only
 * matter for the hourly rate limit and the 15 min lock), and sessions dead for over a week.
 */
export async function runMaintenance(db: Database, now: Date) {
  return withScope(db, PLATFORM, async (tx) => {
    const keys = await tx
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, now))
      .returning({ key: idempotencyKeys.key });
    const otps = await tx
      .delete(otpChallenges)
      .where(lt(otpChallenges.createdAt, new Date(now.getTime() - DAY)))
      .returning({ id: otpChallenges.id });
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const dead = await tx
      .delete(sessions)
      .where(
        or(
          lt(sessions.refreshExpiresAt, weekAgo),
          and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, weekAgo)),
          and(isNotNull(sessions.rotatedAt), lt(sessions.rotatedAt, weekAgo)),
        ),
      )
      .returning({ id: sessions.id });
    return { idempotencyKeys: keys.length, otpChallenges: otps.length, sessions: dead.length };
  });
}
