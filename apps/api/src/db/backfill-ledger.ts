/*
 * One-off: posts ledger entries for money movements recorded before the ledger existed
 * (delivered orders, rider pay, approved bank transfers, cash handovers). Safe to run again: each
 * movement is skipped once its ledger transaction exists. Development data only; production
 * starts with the ledger in place.
 */
import { and, eq, sql } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { postCashHandover, postDelivery, postPrepayment, postRiderPay } from '../ledger/ledger.js';
import { createDb, createPool, PLATFORM, withScope } from './client.js';
import { bankSlips, cashHandovers, offers, orders } from './schema.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  try {
    await withScope(db, PLATFORM, async (tx) => {
      const has = (kind: string) =>
        sql`exists (select 1 from ledger_transactions lt where lt.kind = ${kind} and lt.order_id = ${orders.id})`;

      // Bank transfers approved before the ledger: money in, held for the customer.
      const prepaid = await tx
        .select({ order: orders })
        .from(orders)
        .innerJoin(
          bankSlips,
          and(eq(bankSlips.orderId, orders.id), eq(bankSlips.status, 'approved')),
        )
        .where(sql`not ${has('prepayment_received')}`);
      for (const { order } of prepaid) {
        await postPrepayment(tx, {
          orderId: order.id,
          customerId: order.customerId,
          amountCents: order.totalCents,
          actorId: order.customerId,
        });
      }

      const delivered = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.status, 'delivered'), sql`not ${has('order_delivered')}`));
      for (const o of delivered) await postDelivery(tx, o, null);

      const paid = await tx
        .select({ orderId: orders.id, riderId: offers.riderId, payoutCents: offers.payoutCents })
        .from(orders)
        .innerJoin(
          offers,
          and(
            eq(offers.orderId, orders.id),
            eq(offers.riderId, orders.riderId),
            eq(offers.outcome, 'accepted'),
          ),
        )
        .where(and(eq(orders.status, 'delivered'), sql`not ${has('rider_pay')}`));
      for (const p of paid) await postRiderPay(tx, { ...p, actorId: null });

      const handovers = await tx
        .select()
        .from(cashHandovers)
        .where(
          sql`not exists (select 1 from ledger_transactions lt where lt.kind = 'cash_handover' and lt.memo = 'handover ' || ${cashHandovers.id})`,
        );
      for (const h of handovers) {
        await postCashHandover(tx, {
          riderId: h.riderId,
          amountCents: h.amountCents,
          actorId: h.recordedBy,
          handoverId: h.id,
        });
      }
      console.log(
        `ledger backfill: ${prepaid.length} prepayments, ${delivered.length} deliveries, ${paid.length} rider pay, ${handovers.length} handovers`,
      );
    });
  } finally {
    await pool.end();
  }
}

await main();
