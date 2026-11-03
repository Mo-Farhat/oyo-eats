import { assertCents, type Cents } from './money.js';
import type { PaymentMethod } from './order-state.js';

/*
 * An item the kitchen can't make after accepting (RES-05). The kitchen says how many of the line it
 * can still make and may suggest a substitute; the customer swaps or removes the rest, and if they
 * don't answer in time the rest is removed. The order total changes in place: cash orders collect
 * less (or more) at the door, and a prepaid order is refunded the difference by the office.
 */

export const ITEM_CHANGE_CHOICES = ['substitute', 'remove'] as const;
export type ItemChangeChoice = (typeof ITEM_CHANGE_CHOICES)[number];

export interface ItemChangeLine {
  quantity: number;
  /** Unit price plus modifiers, times quantity. */
  lineTotalCents: Cents;
}

export interface ItemChangeResult {
  /** What stays of the original line, or null when none of it can be made. */
  keep: ItemChangeLine | null;
  /** The substitute line to add, when the customer took it. */
  substitute: { quantity: number; unitPriceCents: Cents; lineTotalCents: Cents } | null;
  /** Change to the food total: negative when the order got cheaper. */
  deltaCents: Cents;
}

/** How many of the line are missing, and what they cost (modifiers included). */
export function missingPart(line: ItemChangeLine, availableQuantity: number) {
  if (!Number.isSafeInteger(availableQuantity) || availableQuantity < 0)
    throw new RangeError(`Available quantity must be 0 or more, got ${availableQuantity}`);
  if (availableQuantity >= line.quantity)
    throw new RangeError('At least one of the line must be unavailable');
  const unit = line.lineTotalCents / line.quantity;
  if (!Number.isSafeInteger(unit)) throw new RangeError('Line total is not a whole unit price');
  const quantity = line.quantity - availableQuantity;
  return { quantity, cents: unit * quantity, unitCents: unit };
}

/**
 * A substitute may cost more only on cash orders, where the customer pays at the door. A prepaid
 * order can't be charged again, so its substitute must cost no more than what it replaces.
 */
export function substituteAllowed(
  paymentMethod: PaymentMethod,
  line: ItemChangeLine,
  availableQuantity: number,
  substitutePriceCents: Cents,
): boolean {
  const missing = missingPart(line, availableQuantity);
  return paymentMethod === 'cod' || substitutePriceCents * missing.quantity <= missing.cents;
}

export function applyItemChange(
  line: ItemChangeLine,
  availableQuantity: number,
  choice: ItemChangeChoice,
  substitutePriceCents: Cents | null,
): ItemChangeResult {
  const missing = missingPart(line, availableQuantity);
  const keep =
    availableQuantity > 0
      ? { quantity: availableQuantity, lineTotalCents: missing.unitCents * availableQuantity }
      : null;
  if (choice === 'remove') return { keep, substitute: null, deltaCents: -missing.cents };
  if (substitutePriceCents === null) throw new RangeError('No substitute was offered');
  assertCents(substitutePriceCents);
  const total = substitutePriceCents * missing.quantity;
  assertCents(total);
  return {
    keep,
    substitute: {
      quantity: missing.quantity,
      unitPriceCents: substitutePriceCents,
      lineTotalCents: total,
    },
    deltaCents: total - missing.cents,
  };
}
