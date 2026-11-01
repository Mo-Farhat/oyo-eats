import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { ROLES_REQUIRING_2FA, type Role, type SetupStep } from '@oyo/shared';
import { decrypt, encrypt, hmac, randomOtp, randomToken, sha256 } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import { accounts, auditLog, devices, otpChallenges, sessions } from '../db/schema.js';
import type { SmsSender } from '../sms/sms.js';
import { ApiError, secondsUntil, unwrap, type Outcome } from '../common/api-error.js';
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
  type BreachedPasswordChecker,
} from './passwords.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

const MINUTE = 60_000;
const OTP_TTL = 5 * MINUTE;
const OTP_RESEND_AFTER = 30_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK = 15 * MINUTE;
const OTP_MAX_PER_HOUR = 5;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_BASE = 15 * MINUTE;
const LOGIN_LOCK_MAX = 24 * 60 * MINUTE;
const ACCESS_TTL = 15 * MINUTE;
/** Admin faces sign out after 30 min idle (SEC-08); everyone else stays signed in for 30 days. */
const REFRESH_TTL: Record<Role, number> = {
  customer: 30 * 24 * 60 * MINUTE,
  rider: 30 * 24 * 60 * MINUTE,
  restaurant_staff: 30 * 24 * 60 * MINUTE,
  restaurant_owner: 30 * 24 * 60 * MINUTE,
  dispatcher: 30 * MINUTE,
  owner: 30 * MINUTE,
};
const DEVICE_BOUND_ROLES: readonly Role[] = ['rider', 'restaurant_staff', 'restaurant_owner'];

export interface AuthKeys {
  hashKey: Buffer;
  encryptionKey: Buffer;
}

export interface RequestMeta {
  ip?: string;
  deviceId?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export type { SetupStep } from '@oyo/shared';

export interface SignInResult {
  tokens: Tokens;
  account: { id: string; role: Role; displayName: string; tenantId: string | null };
  /** Non-empty means a limited session: only these steps (and sign-out) are allowed. */
  setup: SetupStep[];
}

/** What a valid access token resolves to. Attached to every authenticated request. */
export interface AuthContext {
  accountId: string;
  role: Role;
  tenantId: string | null;
  sessionId: string;
  familyId: string;
  deviceId: string | null;
  limited: boolean;
}

type Account = typeof accounts.$inferSelect;

function setupSteps(account: Account): SetupStep[] {
  const steps: SetupStep[] = [];
  if (account.mustChangePassword) steps.push('change_password');
  if (ROLES_REQUIRING_2FA.includes(account.role) && !account.totpSecretCiphertext) {
    steps.push('enroll_totp');
  }
  return steps;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly keys: AuthKeys,
    private readonly sms: SmsSender,
    private readonly breached: BreachedPasswordChecker,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  phoneHash(phoneE164: string): string {
    return hmac(this.keys.hashKey, `phone:${phoneE164}`);
  }

  private codeHash(salt: string, code: string): string {
    return `${salt}.${hmac(this.keys.hashKey, `otp:${salt}:${code}`)}`;
  }

  // Customer phone OTP (CUS-01, SEC-01)

  async requestOtp(phoneE164: string, meta: RequestMeta): Promise<{ resendAfterSeconds: number }> {
    const now = this.clock();
    const phoneHash = this.phoneHash(phoneE164);
    const code = randomOtp();

    unwrap(
      await withScope(this.db, PLATFORM, async (tx): Promise<Outcome<null>> => {
        const recent = await tx
          .select()
          .from(otpChallenges)
          .where(
            and(
              eq(otpChallenges.phoneHash, phoneHash),
              gt(otpChallenges.createdAt, new Date(now.getTime() - 60 * MINUTE)),
            ),
          )
          .orderBy(desc(otpChallenges.createdAt));

        const lock = recent.find((c) => c.lockedUntil && c.lockedUntil > now);
        if (lock?.lockedUntil) {
          return {
            error: new ApiError('otp_locked', {
              retryAfterSeconds: secondsUntil(lock.lockedUntil, now),
            }),
          };
        }
        const latest = recent[0];
        if (latest && now.getTime() - latest.createdAt.getTime() < OTP_RESEND_AFTER) {
          const resendAt = new Date(latest.createdAt.getTime() + OTP_RESEND_AFTER);
          return {
            error: new ApiError('otp_resend_too_soon', {
              retryAfterSeconds: secondsUntil(resendAt, now),
            }),
          };
        }
        if (recent.length >= OTP_MAX_PER_HOUR) {
          const oldest = recent[recent.length - 1]!;
          const freeAt = new Date(oldest.createdAt.getTime() + 60 * MINUTE);
          return {
            error: new ApiError('otp_rate_limited', {
              retryAfterSeconds: secondsUntil(freeAt, now),
            }),
          };
        }

        await tx.insert(otpChallenges).values({
          phoneHash,
          codeHash: this.codeHash(randomBytes(16).toString('hex'), code),
          ip: meta.ip,
          createdAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL),
        });
        return { ok: null };
      }),
    );

    await this.sms.send(phoneE164, `Your Oyo Eats code is ${code}. It expires in 5 minutes.`);
    return { resendAfterSeconds: OTP_RESEND_AFTER / 1000 };
  }

  async verifyOtp(
    input: { phone: string; code: string; acceptTerms?: boolean },
    meta: RequestMeta,
  ): Promise<SignInResult> {
    const now = this.clock();
    const phoneHash = this.phoneHash(input.phone);

    return unwrap(
      await withScope(this.db, PLATFORM, async (tx): Promise<Outcome<SignInResult>> => {
        const checked = await this.checkChallenge(tx, phoneHash, input.code, now);
        if ('error' in checked) return checked;
        const challenge = checked.ok;

        let [account] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.phoneHash, phoneHash))
          .limit(1);
        if (!account) {
          // Checked before the code is consumed, so the app can resend with acceptTerms.
          if (!input.acceptTerms) return { error: new ApiError('terms_required') };
          [account] = await tx
            .insert(accounts)
            .values({
              role: 'customer',
              displayName: '',
              phoneHash,
              phoneCiphertext: encrypt(this.keys.encryptionKey, input.phone),
              termsAcceptedAt: now,
            })
            .returning();
          await this.audit(tx, account!, 'auth.customer_signed_up', meta);
        }

        await tx
          .update(otpChallenges)
          .set({ consumedAt: now })
          .where(eq(otpChallenges.id, challenge.id));
        if (account!.status !== 'active') return { error: new ApiError('account_disabled') };

        return { ok: await this.signIn(tx, account!, meta, now) };
      }),
    );
  }

  /**
   * Checks a code against the latest open challenge for a phone: lock, expiry, then the code.
   * A wrong code counts an attempt (committed by the caller's transaction); the 5th locks the phone.
   * Doesn't consume the challenge, so callers can check more before committing to the sign-in.
   */
  private async checkChallenge(
    tx: Tx,
    phoneHash: string,
    code: string,
    now: Date,
  ): Promise<Outcome<typeof otpChallenges.$inferSelect>> {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phoneHash, phoneHash), isNull(otpChallenges.consumedAt)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1)
      .for('update');

    if (!challenge) return { error: new ApiError('otp_invalid', { attemptsLeft: 0 }) };
    if (challenge.lockedUntil && challenge.lockedUntil > now) {
      return {
        error: new ApiError('otp_locked', {
          retryAfterSeconds: secondsUntil(challenge.lockedUntil, now),
        }),
      };
    }
    if (challenge.expiresAt <= now) return { error: new ApiError('otp_expired') };

    const [salt] = challenge.codeHash.split('.');
    if (this.codeHash(salt!, code) !== challenge.codeHash) {
      const attempts = challenge.attempts + 1;
      const locked = attempts >= OTP_MAX_ATTEMPTS;
      await tx
        .update(otpChallenges)
        .set({
          attempts,
          ...(locked ? { lockedUntil: new Date(now.getTime() + OTP_LOCK), consumedAt: now } : {}),
        })
        .where(eq(otpChallenges.id, challenge.id));
      return locked
        ? { error: new ApiError('otp_locked', { retryAfterSeconds: OTP_LOCK / 1000 }) }
        : { error: new ApiError('otp_invalid', { attemptsLeft: OTP_MAX_ATTEMPTS - attempts }) };
    }
    return { ok: challenge };
  }

  // Verified phone change (CUS-18): a code goes to the new number; the switch happens on confirm.

  async requestPhoneChange(auth: AuthContext, newPhone: string, meta: RequestMeta) {
    const [taken] = await withScope(this.db, PLATFORM, (tx) =>
      tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.phoneHash, this.phoneHash(newPhone)))
        .limit(1),
    );
    if (taken) throw new ApiError(taken.id === auth.accountId ? 'phone_unchanged' : 'phone_taken');
    return this.requestOtp(newPhone, meta);
  }

  async confirmPhoneChange(
    auth: AuthContext,
    input: { phone: string; code: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = this.clock();
    const phoneHash = this.phoneHash(input.phone);
    unwrap(
      await withScope(this.db, PLATFORM, async (tx): Promise<Outcome<null>> => {
        const checked = await this.checkChallenge(tx, phoneHash, input.code, now);
        if ('error' in checked) return checked;
        const [taken] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.phoneHash, phoneHash))
          .limit(1);
        if (taken) return { error: new ApiError('phone_taken') };
        await tx
          .update(otpChallenges)
          .set({ consumedAt: now })
          .where(eq(otpChallenges.id, checked.ok.id));
        const [account] = await tx
          .update(accounts)
          .set({ phoneHash, phoneCiphertext: encrypt(this.keys.encryptionKey, input.phone) })
          .where(eq(accounts.id, auth.accountId))
          .returning();
        await this.audit(tx, account!, 'account.phone_changed', meta);
        return { ok: null };
      }),
    );
  }

  // Staff, rider and restaurant sign-in (SEC-02, SEC-03, SEC-06, SEC-07)

  async login(
    input: { username: string; password: string; totpCode?: string; platform?: string },
    meta: RequestMeta,
  ): Promise<SignInResult> {
    const now = this.clock();
    const [account] = await withScope(this.db, PLATFORM, (tx) =>
      tx
        .select()
        .from(accounts)
        .where(sql`lower(${accounts.username}) = lower(${input.username})`)
        .limit(1),
    );

    if (!account?.passwordHash) {
      await verifyAgainstDummy(input.password);
      throw new ApiError('invalid_credentials');
    }
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new ApiError('account_locked', {
        retryAfterSeconds: secondsUntil(account.lockedUntil, now),
      });
    }
    if (!(await verifyPassword(account.passwordHash, input.password))) {
      await this.recordLoginFailure(account, meta, now, 'password');
      throw new ApiError('invalid_credentials');
    }
    if (account.status !== 'active') throw new ApiError('account_disabled');

    // TOTP before device binding, so a leaked password alone can't create pending devices.
    let totpStep: number | null = null;
    if (account.totpSecretCiphertext) {
      if (!input.totpCode) throw new ApiError('totp_required');
      const secret = decrypt(this.keys.encryptionKey, account.totpSecretCiphertext);
      totpStep = verifyTotp(secret, input.totpCode, now, account.totpLastStep);
      if (totpStep === null) {
        await this.recordLoginFailure(account, meta, now, 'totp');
        throw new ApiError('totp_invalid');
      }
    }

    return unwrap(
      await withScope(this.db, PLATFORM, async (tx): Promise<Outcome<SignInResult>> => {
        if (DEVICE_BOUND_ROLES.includes(account.role)) {
          const deviceError = await this.checkDevice(
            tx,
            account,
            meta.deviceId,
            input.platform,
            now,
          );
          if (deviceError) return { error: deviceError };
        }
        const [fresh] = await tx
          .update(accounts)
          .set({
            failedLoginCount: 0,
            lockedUntil: null,
            ...(totpStep !== null ? { totpLastStep: totpStep } : {}),
          })
          .where(eq(accounts.id, account.id))
          .returning();
        await this.audit(tx, fresh!, 'auth.signed_in', meta);
        return { ok: await this.signIn(tx, fresh!, meta, now) };
      }),
    );
  }

  private async checkDevice(
    tx: Tx,
    account: Account,
    deviceId: string | undefined,
    platform: string | undefined,
    now: Date,
  ): Promise<ApiError | null> {
    if (!deviceId) return new ApiError('device_required');
    const known = await tx.select().from(devices).where(eq(devices.accountId, account.id));
    const device = known.find((d) => d.deviceId === deviceId);
    if (device) {
      if (device.status === 'revoked') return new ApiError('device_revoked');
      if (device.status === 'pending') return new ApiError('device_pending_approval');
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
      return null;
    }
    // The first device binds itself; any later one waits for an admin.
    const first = !known.some((d) => d.status === 'approved');
    await tx.insert(devices).values({
      accountId: account.id,
      deviceId,
      platform,
      status: first ? 'approved' : 'pending',
      firstSeenAt: now,
      lastSeenAt: now,
    });
    await this.audit(tx, account, first ? 'auth.device_bound' : 'auth.device_pending', {
      deviceId,
    });
    return first ? null : new ApiError('device_pending_approval');
  }

  private async recordLoginFailure(
    account: Account,
    meta: RequestMeta,
    now: Date,
    factor: 'password' | 'totp',
  ) {
    await withScope(this.db, PLATFORM, async (tx) => {
      const [updated] = await tx
        .update(accounts)
        .set({ failedLoginCount: sql`${accounts.failedLoginCount} + 1` })
        .where(eq(accounts.id, account.id))
        .returning({ failedLoginCount: accounts.failedLoginCount });
      const failures = updated!.failedLoginCount;
      await this.audit(tx, account, 'auth.sign_in_failed', meta, { factor, failures });
      if (failures >= LOGIN_MAX_FAILURES) {
        // 15 min, doubling with each further failure, capped at 24 h.
        const lockMs = Math.min(
          LOGIN_LOCK_BASE * 2 ** (failures - LOGIN_MAX_FAILURES),
          LOGIN_LOCK_MAX,
        );
        const lockedUntil = new Date(now.getTime() + lockMs);
        await tx.update(accounts).set({ lockedUntil }).where(eq(accounts.id, account.id));
        await this.audit(tx, account, 'auth.account_locked', meta, { failures, lockedUntil });
      }
    });
  }

  // Sessions (SEC-04)

  private async signIn(
    tx: Tx,
    account: Account,
    meta: RequestMeta,
    now: Date,
  ): Promise<SignInResult> {
    const setup = setupSteps(account);
    return {
      tokens: await this.issueTokens(tx, account, {
        familyId: randomUUID(),
        limited: setup.length > 0,
        meta,
        now,
      }),
      account: {
        id: account.id,
        role: account.role,
        displayName: account.displayName,
        tenantId: account.tenantId,
      },
      setup,
    };
  }

  private async issueTokens(
    tx: Tx,
    account: Account,
    opts: { familyId: string; limited: boolean; meta: RequestMeta; now: Date },
  ): Promise<Tokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = new Date(opts.now.getTime() + ACCESS_TTL);
    const refreshExpiresAt = new Date(opts.now.getTime() + REFRESH_TTL[account.role]);
    await tx.insert(sessions).values({
      accountId: account.id,
      familyId: opts.familyId,
      deviceId: opts.meta.deviceId,
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      limited: opts.limited,
      ip: opts.meta.ip,
      createdAt: opts.now,
    });
    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<Tokens> {
    const now = this.clock();
    return unwrap(
      await withScope(this.db, PLATFORM, async (tx): Promise<Outcome<Tokens>> => {
        const [row] = await tx
          .select({ session: sessions, account: accounts })
          .from(sessions)
          .innerJoin(accounts, eq(accounts.id, sessions.accountId))
          .where(eq(sessions.refreshTokenHash, sha256(refreshToken)))
          .limit(1)
          .for('update');
        if (!row || row.session.revokedAt) return { error: new ApiError('invalid_token') };

        if (row.session.rotatedAt) {
          // A refresh token was used twice: assume it was stolen and end the whole family.
          await this.revokeFamily(tx, row.session.familyId, 'refresh_reuse', now);
          await this.audit(tx, row.account, 'auth.refresh_reuse_detected', meta, {
            familyId: row.session.familyId,
          });
          return { error: new ApiError('invalid_token') };
        }
        if (row.session.refreshExpiresAt <= now || row.account.status !== 'active') {
          return { error: new ApiError('invalid_token') };
        }

        await tx.update(sessions).set({ rotatedAt: now }).where(eq(sessions.id, row.session.id));
        return {
          ok: await this.issueTokens(tx, row.account, {
            familyId: row.session.familyId,
            limited: setupSteps(row.account).length > 0,
            meta: { ip: meta.ip, deviceId: row.session.deviceId ?? undefined },
            now,
          }),
        };
      }),
    );
  }

  /** Resolves an access token. Revoked, rotated or expired sessions and inactive accounts fail. */
  async authenticate(accessToken: string): Promise<AuthContext> {
    const now = this.clock();
    const [row] = await withScope(this.db, PLATFORM, (tx) =>
      tx
        .select({ session: sessions, account: accounts })
        .from(sessions)
        .innerJoin(accounts, eq(accounts.id, sessions.accountId))
        .where(eq(sessions.accessTokenHash, sha256(accessToken)))
        .limit(1),
    );
    if (
      !row ||
      row.session.revokedAt ||
      row.session.rotatedAt ||
      row.session.accessExpiresAt <= now ||
      row.account.status !== 'active'
    ) {
      throw new ApiError('invalid_token');
    }
    return {
      accountId: row.account.id,
      role: row.account.role,
      tenantId: row.account.tenantId,
      sessionId: row.session.id,
      familyId: row.session.familyId,
      deviceId: row.session.deviceId,
      limited: row.session.limited,
    };
  }

  async logout(ctx: AuthContext): Promise<void> {
    await withScope(this.db, PLATFORM, (tx) =>
      this.revokeFamily(tx, ctx.familyId, 'signed_out', this.clock()),
    );
  }

  private async revokeFamily(tx: Tx, familyId: string, reason: string, now: Date) {
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  private async revokeAccountSessions(tx: Tx, accountId: string, reason: string, now: Date) {
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
  }

  // Password change and TOTP enrolment. Both sign out every session and return fresh tokens.

  async changePassword(
    ctx: AuthContext,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<SignInResult> {
    const account = await this.loadAccount(ctx.accountId);
    if (
      !account.passwordHash ||
      !(await verifyPassword(account.passwordHash, input.currentPassword))
    ) {
      throw new ApiError('password_incorrect');
    }
    if (input.newPassword === input.currentPassword) throw new ApiError('password_reused');
    if (await this.breached.isBreached(input.newPassword)) throw new ApiError('password_breached');
    const passwordHash = await hashPassword(input.newPassword);

    return withScope(this.db, PLATFORM, async (tx) => {
      const now = this.clock();
      const [updated] = await tx
        .update(accounts)
        .set({ passwordHash, mustChangePassword: false, passwordChangedAt: now })
        .where(eq(accounts.id, account.id))
        .returning();
      await this.revokeAccountSessions(tx, account.id, 'password_changed', now);
      await this.audit(tx, updated!, 'auth.password_changed', meta);
      return this.signIn(tx, updated!, { ...meta, deviceId: ctx.deviceId ?? undefined }, now);
    });
  }

  async startTotpEnrollment(ctx: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    const account = await this.loadAccount(ctx.accountId);
    const secret = generateTotpSecret();
    await withScope(this.db, PLATFORM, (tx) =>
      tx
        .update(accounts)
        .set({ totpPendingSecretCiphertext: encrypt(this.keys.encryptionKey, secret) })
        .where(eq(accounts.id, account.id)),
    );
    return { secret, otpauthUri: otpauthUri(secret, account.username ?? account.id) };
  }

  async confirmTotpEnrollment(
    ctx: AuthContext,
    code: string,
    meta: RequestMeta,
  ): Promise<SignInResult> {
    const now = this.clock();
    const account = await this.loadAccount(ctx.accountId);
    if (!account.totpPendingSecretCiphertext) throw new ApiError('totp_not_started');
    const step = verifyTotp(
      decrypt(this.keys.encryptionKey, account.totpPendingSecretCiphertext),
      code,
      now,
      null,
    );
    if (step === null) throw new ApiError('totp_invalid');

    return withScope(this.db, PLATFORM, async (tx) => {
      const [updated] = await tx
        .update(accounts)
        .set({
          totpSecretCiphertext: account.totpPendingSecretCiphertext,
          totpPendingSecretCiphertext: null,
          totpLastStep: step,
        })
        .where(eq(accounts.id, account.id))
        .returning();
      await this.revokeAccountSessions(tx, account.id, 'totp_enabled', now);
      await this.audit(tx, updated!, 'auth.totp_enabled', meta);
      return this.signIn(tx, updated!, { ...meta, deviceId: ctx.deviceId ?? undefined }, now);
    });
  }

  // Account creation (used by the seed now, by ADM-08 later)

  /** Creates a staff, rider or restaurant account with a one-time password, shown once. */
  async createStaffAccount(input: {
    role: Exclude<Role, 'customer'>;
    username: string;
    displayName: string;
    tenantId?: string;
    createdBy?: string;
  }): Promise<{ accountId: string; temporaryPassword: string }> {
    const temporaryPassword = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(temporaryPassword);
    const account = await withScope(this.db, PLATFORM, async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          role: input.role,
          username: input.username,
          displayName: input.displayName,
          tenantId: input.tenantId,
          passwordHash,
          mustChangePassword: true,
        })
        .returning();
      await tx.insert(auditLog).values({
        actorAccountId: input.createdBy,
        actorRole: input.createdBy ? 'owner' : 'system',
        action: 'account.created',
        targetType: 'account',
        targetId: created!.id,
        after: { role: input.role, username: input.username, tenantId: input.tenantId ?? null },
      });
      return created!;
    });
    return { accountId: account.id, temporaryPassword };
  }

  /** An admin approves a pending device (SEC-06). The endpoint comes with the admin face. */
  async approveDevice(deviceRowId: string, approvedBy: string): Promise<void> {
    await withScope(this.db, PLATFORM, (tx) =>
      tx
        .update(devices)
        .set({ status: 'approved', approvedBy })
        .where(and(eq(devices.id, deviceRowId), eq(devices.status, 'pending'))),
    );
  }

  private async loadAccount(accountId: string): Promise<Account> {
    const [account] = await withScope(this.db, PLATFORM, (tx) =>
      tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1),
    );
    if (!account) throw new ApiError('invalid_token');
    return account;
  }

  private async audit(
    tx: Tx,
    account: Account,
    action: string,
    meta: RequestMeta,
    after?: Record<string, unknown>,
  ) {
    await tx.insert(auditLog).values({
      actorAccountId: account.id,
      actorRole: account.role,
      action,
      targetType: 'account',
      targetId: account.id,
      after,
      ip: meta.ip,
      deviceId: meta.deviceId,
    });
  }
}
