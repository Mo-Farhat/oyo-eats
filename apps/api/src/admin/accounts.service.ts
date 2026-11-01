import { randomBytes } from 'node:crypto';
import {
  can,
  type CreateAccountInput,
  type CreatedAccount,
  type Permission,
  type Role,
  type StaffAccount,
} from '@oyo/shared';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { hashPassword } from '../auth/passwords.js';
import { ApiError } from '../common/api-error.js';
import { encrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import { accounts, auditLog, devices, restaurants, riders, sessions } from '../db/schema.js';
import { activeJobs } from '../dispatch/riders.js';

/** Who may create and manage which role (ADM-08, ADM-19). The owner holds all of these. */
const RULES: Partial<Record<Role, { create: Permission; manage: Permission }>> = {
  rider: { create: 'accounts.create_rider', manage: 'riders.manage_status' },
  restaurant_owner: {
    create: 'accounts.create_restaurant_user',
    manage: 'accounts.create_restaurant_user',
  },
  restaurant_staff: {
    create: 'accounts.create_restaurant_user',
    manage: 'accounts.create_restaurant_user',
  },
  dispatcher: { create: 'accounts.create_dispatcher', manage: 'staff.manage' },
};

function allowed(auth: AuthContext, role: Role, action: 'create' | 'manage') {
  const rule = RULES[role];
  if (!rule || !can(auth.role, rule[action])) throw new ApiError('forbidden');
}

/** A one-time password that is easy to read out: three groups, no look-alike characters. */
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(15);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15)]
    .map((g) => g.join(''))
    .join('-');
}

/** Staff, rider and restaurant logins, issued by admins (ADM-08), plus resets, deactivation, devices. */
export class AccountsService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  private async audit(
    tx: Tx,
    auth: AuthContext,
    action: string,
    targetId: string,
    after?: Record<string, unknown>,
  ) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'account',
      targetId,
      after,
      deviceId: auth.deviceId,
    });
  }

  private async freeUsername(tx: Tx, wanted: string): Promise<string> {
    const taken = await tx
      .select({ u: sql<string>`lower(${accounts.username})` })
      .from(accounts)
      .where(sql`lower(${accounts.username}) like ${`${wanted}%`}`);
    const used = new Set(taken.map((t) => t.u));
    if (!used.has(wanted)) return wanted;
    for (let n = 2; ; n++) if (!used.has(`${wanted}${n}`)) return `${wanted}${n}`;
  }

  async create(auth: AuthContext, input: CreateAccountInput): Promise<CreatedAccount> {
    allowed(auth, input.role, 'create');
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    return withScope(this.db, PLATFORM, async (tx) => {
      if ('tenantId' in input) {
        const [r] = await tx
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.id, input.tenantId));
        if (!r) throw new ApiError('not_found', { what: 'restaurant' });
      }
      let username: string;
      if (input.username) {
        const [clash] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(sql`lower(${accounts.username}) = ${input.username}`);
        if (clash) throw new ApiError('username_taken');
        username = input.username;
      } else {
        const first =
          input.displayName
            .toLowerCase()
            .split(/\s+/)[0]!
            .replace(/[^a-z0-9]/g, '') || 'user';
        username = await this.freeUsername(tx, input.role === 'rider' ? `rider.${first}` : first);
      }
      const [account] = await tx
        .insert(accounts)
        .values({
          role: input.role,
          displayName: input.displayName,
          username,
          passwordHash,
          mustChangePassword: true,
          tenantId: 'tenantId' in input ? input.tenantId : null,
          phoneCiphertext: input.phone ? encrypt(this.encryptionKey, input.phone) : null,
        })
        .returning();
      if (input.role === 'rider') {
        await tx.insert(riders).values({
          accountId: account!.id,
          vehicleType: input.vehicleType,
          plate: input.plate,
          nicCiphertext: input.nicNumber ? encrypt(this.encryptionKey, input.nicNumber) : null,
        });
      }
      await this.audit(tx, auth, 'account.created', account!.id, {
        role: input.role,
        username,
        tenantId: 'tenantId' in input ? input.tenantId : null,
      });
      return { accountId: account!.id, username, temporaryPassword: password };
    });
  }

  /** Staff, riders and restaurant users the caller may manage, with devices waiting for approval. */
  list(
    auth: AuthContext,
    filter: { role?: Role; tenantId?: string } = {},
  ): Promise<StaffAccount[]> {
    return withScope(this.db, PLATFORM, async (tx) => listAccounts(tx, auth, filter));
  }

  private async target(tx: Tx, auth: AuthContext, id: string) {
    const [a] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
    if (!a || a.role === 'customer' || a.role === 'owner') throw new ApiError('not_found');
    allowed(auth, a.role, 'manage');
    return a;
  }

  /** New one-time password; the user must change it again, and every session ends (ADM-19). */
  resetPassword(auth: AuthContext, id: string): Promise<CreatedAccount> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const a = await this.target(tx, auth, id);
      const password = temporaryPassword();
      await tx
        .update(accounts)
        .set({
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        })
        .where(eq(accounts.id, id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: 'password_reset' })
        .where(and(eq(sessions.accountId, id), isNull(sessions.revokedAt)));
      await this.audit(tx, auth, 'account.password_reset', id);
      return { accountId: id, username: a.username!, temporaryPassword: password };
    });
  }

  /** Deactivating ends every session at once (section 2). */
  setActive(auth: AuthContext, id: string, active: boolean): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const account = await this.target(tx, auth, id);
      // A rider mid-delivery would strand the food and the cash: reassign the job first.
      if (!active && account.role === 'rider' && ((await activeJobs(tx, [id])).get(id) ?? 0) > 0)
        throw new ApiError('rider_busy');
      const now = new Date();
      await tx
        .update(accounts)
        .set(
          active
            ? { status: 'active', deactivatedAt: null }
            : { status: 'deactivated', deactivatedAt: now },
        )
        .where(eq(accounts.id, id));
      if (!active) {
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: 'account_deactivated' })
          .where(and(eq(sessions.accountId, id), isNull(sessions.revokedAt)));
        await tx.update(riders).set({ online: false }).where(eq(riders.accountId, id));
      }
      await this.audit(tx, auth, active ? 'account.reactivated' : 'account.deactivated', id);
    });
  }

  /** Approve or reject a phone waiting for approval (SEC-06). */
  decideDevice(auth: AuthContext, deviceRowId: string, approve: boolean): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [d] = await tx.select().from(devices).where(eq(devices.id, deviceRowId)).for('update');
      if (!d || d.status !== 'pending') throw new ApiError('not_found');
      await this.target(tx, auth, d.accountId);
      await tx
        .update(devices)
        .set({ status: approve ? 'approved' : 'revoked', approvedBy: auth.accountId })
        .where(eq(devices.id, deviceRowId));
      await this.audit(tx, auth, approve ? 'device.approved' : 'device.rejected', d.accountId, {
        deviceId: d.deviceId,
      });
    });
  }
}

/** Shared with the restaurant detail screen. */
export async function listAccounts(
  tx: Tx,
  auth: AuthContext,
  filter: { role?: Role; tenantId?: string },
): Promise<StaffAccount[]> {
  const manageable = (Object.keys(RULES) as Role[]).filter((r) => can(auth.role, RULES[r]!.manage));
  if (!manageable.length) return [];
  const rows = await tx
    .select()
    .from(accounts)
    .where(
      and(
        inArray(
          accounts.role,
          filter.role ? manageable.filter((r) => r === filter.role) : manageable,
        ),
        filter.tenantId ? eq(accounts.tenantId, filter.tenantId) : undefined,
        ne(accounts.role, 'customer'),
      ),
    )
    .orderBy(asc(accounts.displayName));
  const pending = rows.length
    ? await tx
        .select()
        .from(devices)
        .where(
          and(
            inArray(
              devices.accountId,
              rows.map((r) => r.id),
            ),
            eq(devices.status, 'pending'),
          ),
        )
    : [];
  return rows.map((a) => ({
    id: a.id,
    role: a.role,
    displayName: a.displayName,
    username: a.username,
    active: a.status === 'active',
    tenantId: a.tenantId,
    createdAt: a.createdAt.toISOString(),
    pendingDevices: pending
      .filter((d) => d.accountId === a.id)
      .map((d) => ({
        id: d.id,
        deviceId: d.deviceId,
        platform: d.platform,
        firstSeenAt: d.firstSeenAt.toISOString(),
      })),
  }));
}
