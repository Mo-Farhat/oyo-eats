import type { RiderProfile } from '@oyo/shared';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database, type Tx } from '../db/client.js';
import { accounts, riders } from '../db/schema.js';

export async function emergencyContact(
  tx: Tx,
  riderId: string,
  key: Buffer,
): Promise<{ name: string; phone: string } | null> {
  const [r] = await tx
    .select({ c: riders.emergencyContactCiphertext })
    .from(riders)
    .where(eq(riders.accountId, riderId));
  return r?.c ? (JSON.parse(decrypt(key, r.c)) as { name: string; phone: string }) : null;
}

/** R13 (RID-14): the rider's details and emergency contact (stored encrypted). */
export class RiderProfileService {
  constructor(
    private readonly db: Database,
    private readonly key: Buffer,
  ) {}

  get(auth: AuthContext): Promise<RiderProfile> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .select({ a: accounts, r: riders })
        .from(accounts)
        .innerJoin(riders, eq(riders.accountId, accounts.id))
        .where(eq(accounts.id, auth.accountId));
      if (!row) throw new ApiError('not_found');
      return {
        name: row.a.displayName,
        username: row.a.username,
        phone: row.a.phoneCiphertext ? decrypt(this.key, row.a.phoneCiphertext) : null,
        vehicle: row.r.vehicleType,
        plate: row.r.plate,
        emergencyContact: await emergencyContact(tx, auth.accountId, this.key),
      };
    });
  }

  setEmergencyContact(
    auth: AuthContext,
    contact: { name: string; phone: string },
  ): Promise<RiderProfile> {
    return withScope(this.db, PLATFORM, async (tx) => {
      await tx
        .update(riders)
        .set({ emergencyContactCiphertext: encrypt(this.key, JSON.stringify(contact)) })
        .where(eq(riders.accountId, auth.accountId));
    }).then(() => this.get(auth));
  }
}
