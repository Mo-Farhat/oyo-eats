import type { BankTransferInfo } from '@oyo/shared';
import { desc, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { bankSlips } from '../db/schema.js';
import type { OrderRow } from '../orders/order-events.js';
import type { BusinessSettings } from '../settings/settings.js';

export type SlipRow = typeof bankSlips.$inferSelect;

/** When the customer must have uploaded a slip by (the slip window, PRD section 8). */
export function slipDeadline(order: OrderRow, settings: BusinessSettings): Date {
  return new Date(order.placedAt.getTime() + settings.timers.slipWindowSeconds * 1000);
}

export async function latestSlip(tx: Tx, orderId: string): Promise<SlipRow | undefined> {
  const [slip] = await tx
    .select()
    .from(bankSlips)
    .where(eq(bankSlips.orderId, orderId))
    .orderBy(desc(bankSlips.uploadedAt))
    .limit(1);
  return slip;
}

/** The C08 block of an order: where to pay, how much, by when, and the slip's state. */
export async function bankTransferInfo(
  tx: Tx,
  order: OrderRow,
  settings: BusinessSettings,
  now: Date,
): Promise<BankTransferInfo | null> {
  if (order.paymentMethod !== 'bank_transfer') return null;
  const slip = await latestSlip(tx, order.id);
  const expiresAt = slipDeadline(order, settings);
  return {
    bankDetails: settings.bankDetails ?? null,
    reference: order.reference,
    amountCents: order.totalCents,
    expiresAt: expiresAt.toISOString(),
    slip: slip
      ? {
          status: slip.status,
          uploadedAt: slip.uploadedAt.toISOString(),
          reviewReason: slip.reviewReason,
        }
      : null,
    canUpload: order.status === 'awaiting_payment' && now < expiresAt && slip?.status !== 'pending',
  };
}
