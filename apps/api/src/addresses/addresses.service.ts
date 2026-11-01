import type { AddressInput, AddressResponse, AddressUpdate } from '@oyo/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { decrypt, encrypt } from '../common/crypto.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { customerAddresses } from '../db/schema.js';

type Row = typeof customerAddresses.$inferSelect;

/** Saved delivery addresses (CUS-02). Address text and note are encrypted (SEC-16). */
export class AddressesService {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: Buffer,
  ) {}

  private toResponse(row: Row): AddressResponse {
    return {
      id: row.id,
      label: row.label,
      lat: row.location.y,
      lng: row.location.x,
      addressText: decrypt(this.encryptionKey, row.addressCiphertext),
      note: row.noteCiphertext ? decrypt(this.encryptionKey, row.noteCiphertext) : null,
    };
  }

  private mine(auth: AuthContext, id?: string) {
    const own = and(
      eq(customerAddresses.customerId, auth.accountId),
      isNull(customerAddresses.deletedAt),
    );
    return id ? and(own, eq(customerAddresses.id, id)) : own;
  }

  list(auth: AuthContext): Promise<AddressResponse[]> {
    return withScope(this.db, PLATFORM, async (tx) =>
      (
        await tx
          .select()
          .from(customerAddresses)
          .where(this.mine(auth))
          .orderBy(asc(customerAddresses.createdAt))
      ).map((r) => this.toResponse(r)),
    );
  }

  create(auth: AuthContext, input: AddressInput): Promise<AddressResponse> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .insert(customerAddresses)
        .values({
          customerId: auth.accountId,
          label: input.label,
          location: { x: input.lng, y: input.lat },
          addressCiphertext: encrypt(this.encryptionKey, input.addressText),
          noteCiphertext: input.note ? encrypt(this.encryptionKey, input.note) : null,
        })
        .returning();
      return this.toResponse(row!);
    });
  }

  update(auth: AuthContext, id: string, input: AddressUpdate): Promise<AddressResponse> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .update(customerAddresses)
        .set({
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.lat !== undefined && input.lng !== undefined
            ? { location: { x: input.lng, y: input.lat } }
            : {}),
          ...(input.addressText !== undefined
            ? { addressCiphertext: encrypt(this.encryptionKey, input.addressText) }
            : {}),
          ...(input.note !== undefined
            ? { noteCiphertext: input.note ? encrypt(this.encryptionKey, input.note) : null }
            : {}),
        })
        .where(this.mine(auth, id))
        .returning();
      if (!row) throw new ApiError('not_found');
      return this.toResponse(row);
    });
  }

  /** Soft delete: past orders keep their own snapshot of the address. */
  remove(auth: AuthContext, id: string): Promise<void> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const [row] = await tx
        .update(customerAddresses)
        .set({ deletedAt: new Date() })
        .where(this.mine(auth, id))
        .returning({ id: customerAddresses.id });
      if (!row) throw new ApiError('not_found');
    });
  }
}
