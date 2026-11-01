import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { ledgerEntries, ledgerTransactions } from '../db/schema.js';

export type LedgerAccount = (typeof ledgerEntries.$inferInsert)['account'];

export interface Posting {
  account: LedgerAccount;
  /** Rider, restaurant or customer, for party accounts. */
  partyId?: string | null;
  /** Positive is a debit, negative a credit. */
  amountCents: number;
}

/**
 * Writes one balanced ledger transaction (PRD section 9). Zero lines are dropped; the rest must
 * sum to zero, which the database checks again at commit. Entries are append-only: corrections
 * are new transactions with `reversesId`.
 */
export async function post(
  tx: Tx,
  input: {
    kind: string;
    orderId?: string | null;
    memo?: string;
    createdBy?: string | null;
    entries: Posting[];
  },
): Promise<string | null> {
  const lines = input.entries.filter((e) => e.amountCents !== 0);
  if (!lines.length) return null;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountCents))
      throw new Error(`Ledger amount not in cents: ${l.amountCents}`);
  }
  const sum = lines.reduce((n, l) => n + l.amountCents, 0);
  if (sum !== 0 || lines.length < 2) {
    throw new Error(`Unbalanced ledger posting "${input.kind}": sum ${sum}, ${lines.length} lines`);
  }
  const [t] = await tx
    .insert(ledgerTransactions)
    .values({
      kind: input.kind,
      orderId: input.orderId ?? null,
      memo: input.memo ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: ledgerTransactions.id });
  await tx.insert(ledgerEntries).values(
    lines.map((l) => ({
      transactionId: t!.id,
      account: l.account,
      partyId: l.partyId ?? null,
      amountCents: l.amountCents,
    })),
  );
  return t!.id;
}

interface DeliveredOrder {
  id: string;
  tenantId: string;
  customerId: string;
  riderId: string | null;
  paymentMethod: 'cod' | 'bank_transfer' | 'card';
  itemsCents: number;
  restaurantFeeCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  cashCollectedCents: number | null;
}

/**
 * On delivery the food money becomes owed to the restaurant and the delivery fee is earned.
 * Cash orders: the rider now holds what they collected, and any shortfall is a cash variance.
 * Prepaid orders: the customer's prepayment (held since the payment cleared) is used up.
 */
export async function postDelivery(tx: Tx, o: DeliveredOrder, actorId: string | null) {
  const food = o.itemsCents + o.restaurantFeeCents;
  const source: Posting[] =
    o.paymentMethod === 'cod'
      ? [
          { account: 'rider_cash', partyId: o.riderId, amountCents: o.cashCollectedCents ?? 0 },
          { account: 'cash_variance', amountCents: o.totalCents - (o.cashCollectedCents ?? 0) },
        ]
      : [{ account: 'customer_credit', partyId: o.customerId, amountCents: o.totalCents }];
  await post(tx, {
    kind: 'order_delivered',
    orderId: o.id,
    createdBy: actorId,
    entries: [
      ...source,
      { account: 'restaurant_payable', partyId: o.tenantId, amountCents: -food },
      { account: 'delivery_fee_revenue', amountCents: -o.deliveryFeeCents },
    ],
  });
}

/** Rider pay for one delivery, as fixed on the accepted offer. */
export async function postRiderPay(
  tx: Tx,
  input: { orderId: string; riderId: string; payoutCents: number; actorId: string | null },
) {
  await post(tx, {
    kind: 'rider_pay',
    orderId: input.orderId,
    createdBy: input.actorId,
    entries: [
      { account: 'rider_pay_expense', amountCents: input.payoutCents },
      { account: 'rider_payable', partyId: input.riderId, amountCents: -input.payoutCents },
    ],
  });
}

/** A bank transfer is confirmed: the money is in the bank, held for the customer until delivery. */
export async function postPrepayment(
  tx: Tx,
  input: { orderId: string; customerId: string; amountCents: number; actorId: string },
) {
  await post(tx, {
    kind: 'prepayment_received',
    orderId: input.orderId,
    createdBy: input.actorId,
    entries: [
      { account: 'business_bank', amountCents: input.amountCents },
      { account: 'customer_credit', partyId: input.customerId, amountCents: -input.amountCents },
    ],
  });
}

/** Cash from a rider to the office (ADM-09). A shortfall stays on the rider's cash account. */
export async function postCashHandover(
  tx: Tx,
  input: { riderId: string; amountCents: number; actorId: string; handoverId: string },
) {
  await post(tx, {
    kind: 'cash_handover',
    memo: `handover ${input.handoverId}`,
    createdBy: input.actorId,
    entries: [
      { account: 'business_bank', amountCents: input.amountCents },
      { account: 'rider_cash', partyId: input.riderId, amountCents: -input.amountCents },
    ],
  });
}

/** A settlement or payout is paid from the business bank (ADM-13, ADM-14). */
export async function postSettlementPaid(
  tx: Tx,
  input: {
    party: 'restaurant' | 'rider';
    partyId: string;
    amountCents: number;
    actorId: string;
    settlementId: string;
  },
) {
  await post(tx, {
    kind: input.party === 'restaurant' ? 'restaurant_settlement_paid' : 'rider_payout_paid',
    memo: `settlement ${input.settlementId}`,
    createdBy: input.actorId,
    entries: [
      {
        account: input.party === 'restaurant' ? 'restaurant_payable' : 'rider_payable',
        partyId: input.partyId,
        amountCents: input.amountCents,
      },
      { account: 'business_bank', amountCents: -input.amountCents },
    ],
  });
}

/** Balance of one account (for one party, or all parties), debits positive. */
export async function balance(tx: Tx, account: LedgerAccount, partyId?: string): Promise<number> {
  const [row] = await tx
    .select({ cents: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)` })
    .from(ledgerEntries)
    .where(
      partyId
        ? and(eq(ledgerEntries.account, account), eq(ledgerEntries.partyId, partyId))
        : eq(ledgerEntries.account, account),
    );
  return Number(row?.cents ?? 0);
}
