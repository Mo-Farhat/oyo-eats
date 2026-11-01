/*
 * Auth flows against the real database, each inside a rolled-back transaction.
 * SMS is captured, the breached-password check is faked, and the clock is controllable.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../db/client.js';
import { accounts, devices } from '../db/schema.js';
import { closeTestDb, inRollback, testDatabaseUrl } from '../db/testing.js';
import { AuthService } from './auth.service.js';
import { ApiError, type ApiErrorCode } from '../common/api-error.js';
import { base32Decode, timeStep, totpAt } from './totp.js';

afterAll(closeTestDb);

const PHONE = '+94771234567';
const meta = { ip: '203.0.113.7' };

function setup(tx: Tx) {
  const sent: string[] = [];
  let now = new Date('2026-11-02T06:00:00Z');
  const breachedPasswords = new Set(['password123']);
  const auth = new AuthService(
    tx,
    { hashKey: randomBytes(32), encryptionKey: randomBytes(32) },
    { send: async (_phone, text) => void sent.push(text) },
    { isBreached: async (p) => breachedPasswords.has(p) },
    () => now,
  );
  return {
    auth,
    tick: (ms: number) => void (now = new Date(now.getTime() + ms)),
    now: () => now,
    lastCode: () => sent.at(-1)!.match(/\d{6}/)![0],
  };
}

async function expectApiError(promise: Promise<unknown>, code: ApiErrorCode) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof ApiError && e.code === code);
}

const MIN = 60_000;

describe.skipIf(!testDatabaseUrl)('customer OTP', () => {
  it('signs up a new customer once terms are accepted', () =>
    inRollback(async (tx) => {
      const { auth, lastCode } = setup(tx);
      await auth.requestOtp(PHONE, meta);
      await expectApiError(
        auth.verifyOtp({ phone: PHONE, code: lastCode() }, meta),
        'terms_required',
      );

      const result = await auth.verifyOtp(
        { phone: PHONE, code: lastCode(), acceptTerms: true },
        meta,
      );
      expect(result.account.role).toBe('customer');
      expect(result.setup).toEqual([]);
      const ctx = await auth.authenticate(result.tokens.accessToken);
      expect(ctx).toMatchObject({ role: 'customer', limited: false });

      // The phone is stored hashed and encrypted, never in plain text.
      const [row] = await tx.select().from(accounts).where(eq(accounts.id, ctx.accountId));
      expect(row!.phoneHash).not.toContain('771234567');
      expect(row!.phoneCiphertext!.toString('utf8')).not.toContain('771234567');
    }));

  it('uses each code once', () =>
    inRollback(async (tx) => {
      const { auth, lastCode } = setup(tx);
      await auth.requestOtp(PHONE, meta);
      const code = lastCode();
      await auth.verifyOtp({ phone: PHONE, code, acceptTerms: true }, meta);
      await expectApiError(auth.verifyOtp({ phone: PHONE, code }, meta), 'otp_invalid');
    }));

  it('enforces the 30 s resend wait and the 5 minute expiry', () =>
    inRollback(async (tx) => {
      const { auth, lastCode, tick } = setup(tx);
      await auth.requestOtp(PHONE, meta);
      await expectApiError(auth.requestOtp(PHONE, meta), 'otp_resend_too_soon');
      tick(31_000);
      await auth.requestOtp(PHONE, meta);
      tick(5 * MIN);
      await expectApiError(
        auth.verifyOtp({ phone: PHONE, code: lastCode(), acceptTerms: true }, meta),
        'otp_expired',
      );
    }));

  it('locks the phone for 15 minutes after 5 wrong codes', () =>
    inRollback(async (tx) => {
      const { auth, lastCode, tick } = setup(tx);
      await auth.requestOtp(PHONE, meta);
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        await expectApiError(auth.verifyOtp({ phone: PHONE, code: wrong }, meta), 'otp_invalid');
      }
      await expectApiError(auth.verifyOtp({ phone: PHONE, code: wrong }, meta), 'otp_locked');
      tick(MIN);
      await expectApiError(auth.requestOtp(PHONE, meta), 'otp_locked');
      tick(15 * MIN);
      await auth.requestOtp(PHONE, meta);
      await auth.verifyOtp({ phone: PHONE, code: lastCode(), acceptTerms: true }, meta);
    }));

  it('caps codes at 5 per phone per hour', () =>
    inRollback(async (tx) => {
      const { auth, tick } = setup(tx);
      for (let i = 0; i < 5; i++) {
        await auth.requestOtp(PHONE, meta);
        tick(31_000);
      }
      await expectApiError(auth.requestOtp(PHONE, meta), 'otp_rate_limited');
    }));
});

describe.skipIf(!testDatabaseUrl)('staff sign-in', () => {
  it('forces a password change on first login, then signs out other sessions', () =>
    inRollback(async (tx) => {
      const { auth } = setup(tx);
      const { temporaryPassword } = await auth.createStaffAccount({
        role: 'rider',
        username: 'rider.one',
        displayName: 'Rider One',
      });
      const first = await auth.login(
        { username: 'Rider.One', password: temporaryPassword },
        { ...meta, deviceId: 'phone-aaaa-1111' },
      );
      expect(first.setup).toEqual(['change_password']);
      const ctx = await auth.authenticate(first.tokens.accessToken);
      expect(ctx.limited).toBe(true);

      const change = (newPassword: string) =>
        auth.changePassword(ctx, { currentPassword: temporaryPassword, newPassword }, meta);
      await expectApiError(change('password123'), 'password_breached');
      await expectApiError(change(temporaryPassword), 'password_reused');

      const changed = await change('a-long-new-password');
      expect(changed.setup).toEqual([]);
      await expectApiError(auth.authenticate(first.tokens.accessToken), 'invalid_token');
      expect((await auth.authenticate(changed.tokens.accessToken)).limited).toBe(false);
    }));

  it('locks the account after 5 wrong passwords, with back-off', () =>
    inRollback(async (tx) => {
      const { auth, tick } = setup(tx);
      const { temporaryPassword } = await auth.createStaffAccount({
        role: 'owner',
        username: 'boss',
        displayName: 'Boss',
      });
      for (let i = 0; i < 5; i++) {
        await expectApiError(
          auth.login({ username: 'boss', password: 'wrong' }, meta),
          'invalid_credentials',
        );
      }
      await expectApiError(
        auth.login({ username: 'boss', password: temporaryPassword }, meta),
        'account_locked',
      );
      tick(16 * MIN);
      await expectApiError(
        auth.login({ username: 'boss', password: 'wrong' }, meta),
        'invalid_credentials',
      );
      tick(16 * MIN); // the 6th failure doubled the lock to 30 minutes
      await expectApiError(
        auth.login({ username: 'boss', password: temporaryPassword }, meta),
        'account_locked',
      );
      tick(15 * MIN);
      await auth.login({ username: 'boss', password: temporaryPassword }, meta);
    }));

  it('gives the same answer for unknown users and wrong passwords', () =>
    inRollback(async (tx) => {
      const { auth } = setup(tx);
      await expectApiError(
        auth.login({ username: 'nobody', password: 'x' }, meta),
        'invalid_credentials',
      );
    }));

  it('binds the first device and holds later ones for approval', () =>
    inRollback(async (tx) => {
      const { auth } = setup(tx);
      const { temporaryPassword, accountId } = await auth.createStaffAccount({
        role: 'rider',
        username: 'rider.two',
        displayName: 'Rider Two',
      });
      const login = (deviceId?: string) =>
        auth.login({ username: 'rider.two', password: temporaryPassword }, { ...meta, deviceId });

      await expectApiError(login(), 'device_required');
      await login('phone-first-0001');
      await expectApiError(login('phone-other-0002'), 'device_pending_approval');
      await expectApiError(login('phone-other-0002'), 'device_pending_approval');

      const [pending] = await tx
        .select()
        .from(devices)
        .where(eq(devices.deviceId, 'phone-other-0002'));
      await auth.approveDevice(pending!.id, accountId);
      await login('phone-other-0002');
    }));

  it('requires TOTP enrolment for dispatchers, then a code at every sign-in', () =>
    inRollback(async (tx) => {
      const { auth, now, tick } = setup(tx);
      const { temporaryPassword } = await auth.createStaffAccount({
        role: 'dispatcher',
        username: 'dispatch.one',
        displayName: 'Dispatch One',
      });
      const first = await auth.login(
        { username: 'dispatch.one', password: temporaryPassword },
        meta,
      );
      expect(first.setup).toEqual(['change_password', 'enroll_totp']);
      let ctx = await auth.authenticate(first.tokens.accessToken);
      const changed = await auth.changePassword(
        ctx,
        { currentPassword: temporaryPassword, newPassword: 'dispatch-pass-2026' },
        meta,
      );
      expect(changed.setup).toEqual(['enroll_totp']);
      ctx = await auth.authenticate(changed.tokens.accessToken);

      const { secret, otpauthUri } = await auth.startTotpEnrollment(ctx);
      expect(otpauthUri).toContain('issuer=Oyo%20Eats');
      const codeNow = () => totpAt(base32Decode(secret), timeStep(now()));
      await expectApiError(auth.confirmTotpEnrollment(ctx, '000000', meta), 'totp_invalid');
      const enrolled = await auth.confirmTotpEnrollment(ctx, codeNow(), meta);
      expect(enrolled.setup).toEqual([]);

      const login = (totpCode?: string) =>
        auth.login({ username: 'dispatch.one', password: 'dispatch-pass-2026', totpCode }, meta);
      await expectApiError(login(), 'totp_required');
      await expectApiError(login(codeNow()), 'totp_invalid'); // same step as enrolment: replay
      tick(30_000);
      const full = await login(codeNow());
      expect((await auth.authenticate(full.tokens.accessToken)).limited).toBe(false);
    }));
});

describe.skipIf(!testDatabaseUrl)('sessions', () => {
  async function signedInCustomer(tx: Tx) {
    const s = setup(tx);
    await s.auth.requestOtp(PHONE, meta);
    const result = await s.auth.verifyOtp(
      { phone: PHONE, code: s.lastCode(), acceptTerms: true },
      meta,
    );
    return { ...s, tokens: result.tokens };
  }

  it('rotates refresh tokens and retires the old access token', () =>
    inRollback(async (tx) => {
      const { auth, tokens } = await signedInCustomer(tx);
      const next = await auth.refresh(tokens.refreshToken, meta);
      await expectApiError(auth.authenticate(tokens.accessToken), 'invalid_token');
      await auth.authenticate(next.accessToken);
    }));

  it('revokes the whole family when a refresh token is reused', () =>
    inRollback(async (tx) => {
      const { auth, tokens } = await signedInCustomer(tx);
      const next = await auth.refresh(tokens.refreshToken, meta);
      await expectApiError(auth.refresh(tokens.refreshToken, meta), 'invalid_token');
      await expectApiError(auth.authenticate(next.accessToken), 'invalid_token');
      await expectApiError(auth.refresh(next.refreshToken, meta), 'invalid_token');
    }));

  it('expires access tokens after 15 minutes', () =>
    inRollback(async (tx) => {
      const { auth, tokens, tick } = await signedInCustomer(tx);
      tick(15 * MIN);
      await expectApiError(auth.authenticate(tokens.accessToken), 'invalid_token');
      await auth.refresh(tokens.refreshToken, meta);
    }));

  it('signs out admins after 30 minutes idle', () =>
    inRollback(async (tx) => {
      const { auth, tick } = setup(tx);
      const { temporaryPassword } = await auth.createStaffAccount({
        role: 'owner',
        username: 'owner.idle',
        displayName: 'Owner',
      });
      const { tokens } = await auth.login(
        { username: 'owner.idle', password: temporaryPassword },
        meta,
      );
      tick(31 * MIN);
      await expectApiError(auth.refresh(tokens.refreshToken, meta), 'invalid_token');
    }));

  it('cuts off a deactivated account immediately', () =>
    inRollback(async (tx) => {
      const { auth, tokens } = await signedInCustomer(tx);
      const ctx = await auth.authenticate(tokens.accessToken);
      await tx
        .update(accounts)
        .set({ status: 'deactivated' })
        .where(eq(accounts.id, ctx.accountId));
      await expectApiError(auth.authenticate(tokens.accessToken), 'invalid_token');
      await expectApiError(auth.refresh(tokens.refreshToken, meta), 'invalid_token');
    }));

  it('signs out a device family', () =>
    inRollback(async (tx) => {
      const { auth, tokens } = await signedInCustomer(tx);
      await auth.logout(await auth.authenticate(tokens.accessToken));
      await expectApiError(auth.authenticate(tokens.accessToken), 'invalid_token');
      await expectApiError(auth.refresh(tokens.refreshToken, meta), 'invalid_token');
    }));
});
