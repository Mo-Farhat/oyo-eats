import { createHash, randomUUID } from 'node:crypto';
import type { SlipRejectInput, SlipReviewItem, SlipUploadInput } from '@oyo/shared';
import { and, asc, eq, or } from 'drizzle-orm';
import sharp from 'sharp';
import type { AuthContext } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { PLATFORM, withScope, type Database } from '../db/client.js';
import { auditLog, bankSlips, orderEvents, orders, payments, restaurants } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { postPrepayment } from '../ledger/ledger.js';
import { applyOrderEvent } from '../orders/order-events.js';
import { ORDER_QUEUES } from '../orders/queues.js';
import { loadSettings } from '../settings/settings.js';
import type { FileStorage } from '../storage/storage.js';
import { latestSlip, slipDeadline } from './bank-transfer.js';

export const SLIP_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

/**
 * Bank-transfer slips (CUS-09, ADM-10, SEC-17, SEC-24). Images are decoded and re-encoded, which
 * drops EXIF (location) and anything hidden in the file; the original bytes' hash blocks reuse.
 */
export class SlipsService {
  constructor(
    private readonly db: Database,
    private readonly storage: FileStorage,
    private readonly jobs: JobQueue,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async upload(
    auth: AuthContext,
    orderId: string,
    file: UploadedFile | undefined,
    input: SlipUploadInput,
  ): Promise<void> {
    if (!file || file.size === 0) throw new ApiError('slip_invalid', { reason: 'missing' });
    if (file.size > SLIP_MAX_BYTES)
      throw new ApiError('slip_invalid', { reason: 'too_large', maxBytes: SLIP_MAX_BYTES });

    // Trust the decoder, not the client's content type.
    const meta = await sharp(file.buffer)
      .metadata()
      .catch(() => null);
    if (!meta?.format || !ACCEPTED_FORMATS.has(meta.format))
      throw new ApiError('slip_invalid', { reason: 'format' });
    const clean = await sharp(file.buffer)
      .rotate() // apply the camera orientation before metadata is dropped
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const imageSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const now = this.clock();

    await withScope(this.db, PLATFORM, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || order.customerId !== auth.accountId) throw new ApiError('not_found');
      if (order.paymentMethod !== 'bank_transfer' || order.status !== 'awaiting_payment') {
        throw new ApiError('invalid_transition', { status: order.status });
      }
      const settings = await loadSettings(tx);
      if (now >= slipDeadline(order, settings)) throw new ApiError('slip_window_closed');
      if ((await latestSlip(tx, order.id))?.status === 'pending')
        throw new ApiError('slip_pending');

      const bankReference = input.bankReference || null;
      const [reused] = await tx
        .select({ id: bankSlips.id })
        .from(bankSlips)
        .where(
          bankReference
            ? or(eq(bankSlips.imageSha256, imageSha256), eq(bankSlips.bankReference, bankReference))
            : eq(bankSlips.imageSha256, imageSha256),
        )
        .limit(1);
      if (reused) throw new ApiError('slip_duplicate');

      const imageKey = `slips/${order.id}/${randomUUID()}.jpg`;
      await this.storage.put(imageKey, clean, 'image/jpeg');
      await tx.insert(bankSlips).values({
        tenantId: order.tenantId,
        orderId: order.id,
        imageKey,
        imageSha256,
        bankReference,
        uploadedAt: now,
      });
      await tx.insert(orderEvents).values({
        tenantId: order.tenantId,
        orderId: order.id,
        type: 'slip_uploaded',
        actorAccountId: auth.accountId,
        actorRole: auth.role,
        deviceId: auth.deviceId,
      });
    });
  }

  /** A12 queue: slips waiting for a decision, oldest first. */
  queue(): Promise<SlipReviewItem[]> {
    return withScope(this.db, PLATFORM, async (tx) => {
      const settings = await loadSettings(tx);
      const rows = await tx
        .select({ slip: bankSlips, order: orders, restaurantName: restaurants.name })
        .from(bankSlips)
        .innerJoin(orders, eq(orders.id, bankSlips.orderId))
        .innerJoin(restaurants, eq(restaurants.id, orders.tenantId))
        .where(eq(bankSlips.status, 'pending'))
        .orderBy(asc(bankSlips.uploadedAt));
      return Promise.all(
        rows.map(async ({ slip, order, restaurantName }) => ({
          slipId: slip.id,
          orderId: order.id,
          reference: order.reference,
          restaurantName,
          amountCents: order.totalCents,
          declaredAmountCents: slip.declaredAmountCents,
          bankReference: slip.bankReference,
          uploadedAt: slip.uploadedAt.toISOString(),
          expiresAt: slipDeadline(order, settings).toISOString(),
          imageUrl: await this.storage.signedUrl(slip.imageKey, 600),
        })),
      );
    });
  }

  /** Approve: the order goes to the restaurant and its response timer starts. */
  async approve(auth: AuthContext, slipId: string): Promise<void> {
    const { orderId, responseSeconds } = await withScope(this.db, PLATFORM, async (tx) => {
      const slip = await this.pendingSlip(tx, slipId);
      const now = this.clock();
      const order = await applyOrderEvent(
        tx,
        slip.orderId,
        'slip_approved',
        { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId },
        { slipId },
      );
      await tx
        .update(bankSlips)
        .set({ status: 'approved', reviewedBy: auth.accountId, reviewedAt: now })
        .where(eq(bankSlips.id, slipId));
      await postPrepayment(tx, {
        orderId: order.id,
        customerId: order.customerId,
        amountCents: order.totalCents,
        actorId: auth.accountId,
      });
      await tx
        .update(payments)
        .set({ status: 'confirmed', confirmedAt: now })
        .where(and(eq(payments.orderId, slip.orderId), eq(payments.method, 'bank_transfer')));
      await this.audit(tx, auth, 'slip.approved', slipId, { orderId: slip.orderId });
      return {
        orderId: slip.orderId,
        responseSeconds: (await loadSettings(tx)).timers.restaurantResponseSeconds,
      };
    });
    await this.jobs.sendAfter(ORDER_QUEUES.restaurantTimeout, { orderId }, responseSeconds);
  }

  /**
   * Reject, usually asking for a new slip (the customer can upload again inside the window). A final
   * rejection cancels the order.
   */
  async reject(auth: AuthContext, slipId: string, input: SlipRejectInput): Promise<void> {
    await withScope(this.db, PLATFORM, async (tx) => {
      const slip = await this.pendingSlip(tx, slipId);
      const status = input.resubmit ? 'resubmit_requested' : 'rejected';
      await tx
        .update(bankSlips)
        .set({
          status,
          reviewReason: input.reason,
          reviewedBy: auth.accountId,
          reviewedAt: this.clock(),
        })
        .where(eq(bankSlips.id, slipId));
      await tx.insert(orderEvents).values({
        tenantId: slip.tenantId,
        orderId: slip.orderId,
        type: 'slip_rejected',
        actorAccountId: auth.accountId,
        actorRole: auth.role,
        deviceId: auth.deviceId,
        payload: { reason: input.reason, resubmit: input.resubmit },
      });
      // A final rejection (no money arrived, or not a real slip) ends the order now, rather than
      // leaving the customer waiting for the window to run out.
      if (!input.resubmit) {
        await applyOrderEvent(
          tx,
          slip.orderId,
          'cancelled_by_admin',
          { role: auth.role, accountId: auth.accountId, deviceId: auth.deviceId },
          { reason: input.reason },
        );
        await tx
          .update(payments)
          .set({ status: 'failed' })
          .where(and(eq(payments.orderId, slip.orderId), eq(payments.status, 'pending')));
      }
      await this.audit(tx, auth, 'slip.rejected', slipId, {
        orderId: slip.orderId,
        reason: input.reason,
        resubmit: input.resubmit,
      });
    });
  }

  private async pendingSlip(tx: Parameters<Parameters<typeof withScope>[2]>[0], slipId: string) {
    const [slip] = await tx.select().from(bankSlips).where(eq(bankSlips.id, slipId)).for('update');
    if (!slip) throw new ApiError('not_found');
    if (slip.status !== 'pending')
      throw new ApiError('invalid_transition', { status: slip.status });
    return slip;
  }

  private async audit(
    tx: Parameters<Parameters<typeof withScope>[2]>[0],
    auth: AuthContext,
    action: string,
    slipId: string,
    after: Record<string, unknown>,
  ) {
    await tx.insert(auditLog).values({
      actorAccountId: auth.accountId,
      actorRole: auth.role,
      action,
      targetType: 'bank_slip',
      targetId: slipId,
      after,
      deviceId: auth.deviceId,
    });
  }
}
