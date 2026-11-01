import { TERMINAL_STATUSES, type ProfileResponse, type ProfileUpdateInput } from '@oyo/shared';
import { and, count, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import {
  accounts,
  auditLog,
  customerAddresses,
  devices,
  orderItems,
  orders,
  reviews,
  sessions,
} from '../db/schema.js';

/** Customer profile (CUS-18) and account deletion (PRI-06). */
export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async openOrders(tx: Tx, accountId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(orders)
      .where(
        and(eq(orders.customerId, accountId), notInArray(orders.status, [...TERMINAL_STATUSES])),
      );
    return Number(row?.n ?? 0);
  }

  get(auth: AuthContext): Promise<ProfileResponse> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, auth.accountId));
      if (!a) throw new ApiError('not_found');
      return {
        displayName: a.displayName,
        phone: a.phoneCiphertext ? decrypt(this.encryptionKey, a.phoneCiphertext) : '',
        marketingOptIn: a.marketingOptIn,
        hasOpenOrders: (await this.openOrders(tx, a.id)) > 0,
      };
    });
  }

  async update(auth: AuthContext, input: ProfileUpdateInput): Promise<ProfileResponse> {
    await withScope(this.db, PLATFORM, (tx) =>
      tx
        .update(accounts)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.marketingOptIn !== undefined ? { marketingOptIn: input.marketingOptIn } : {}),
        })
        .where(eq(accounts.id, auth.accountId)),
    );
    return this.get(auth);
  }

  /**
   * Deletes the account (CUS-18, PRI-06): blocked while an order is open; otherwise personal data
   * is removed or anonymised at once and the anonymised order and financial records stay.
   */
  delete(auth: AuthContext): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      if ((await this.openOrders(tx, auth.accountId)) > 0) throw new ApiError('account_busy');
      const now = this.clock();
      const id = auth.accountId;
      await tx
        .update(accounts)
        .set({
          status: 'deactivated',
          deactivatedAt: now,
          displayName: '',
          // Keeps the "customers have a phone hash" rule while matching no real number.
          phoneHash: `deleted:${id}`,
          phoneCiphertext: null,
          marketingOptIn: false,
        })
        .where(eq(accounts.id, id));
      await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, id));
      // Past orders keep amounts and items; the address goes, and the pin is blurred to ~1 km.
      await tx
        .update(orders)
        .set({
          deliveryAddressCiphertext: null,
          deliveryNoteCiphertext: null,
          deliveryLocation: sql`ST_SetSRID(ST_MakePoint(round(ST_X(${orders.deliveryLocation})::numeric, 2), round(ST_Y(${orders.deliveryLocation})::numeric, 2)), 4326)`,
        })
        .where(eq(orders.customerId, id));
      await tx
        .update(orderItems)
        .set({ note: null })
        .where(
          sql`${orderItems.orderId} in (select id from ${orders} where ${orders.customerId} = ${id})`,
        );
      // Ratings stay (they're anonymous now); free text could identify the customer, so it goes.
      await tx.update(reviews).set({ body: null }).where(eq(reviews.customerId, id));
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: 'account_deleted' })
        .where(and(eq(sessions.accountId, id), isNull(sessions.revokedAt)));
      await tx.update(devices).set({ status: 'revoked' }).where(eq(devices.accountId, id));
      await tx.insert(auditLog).values({
        actorAccountId: id,
        actorRole: auth.role,
        action: 'account.deleted',
        targetType: 'account',
        targetId: id,
        deviceId: auth.deviceId,
      });
    });
  }
}
