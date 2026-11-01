import { assertCents, sumCents, type Cents } from './money.js';

/** One order line priced from the server's menu data, never from the client. */
export interface PricedLine {
  unitPriceCents: Cents;
  modifierPriceCents: readonly Cents[];
  quantity: number;
}

export interface OrderTotals {
  itemsCents: Cents;
  deliveryFeeCents: Cents;
  restaurantFeeCents: Cents;
  totalCents: Cents;
}

export function lineTotal(line: PricedLine): Cents {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError(`Quantity must be a positive integer, got ${line.quantity}`);
  }
  const unit = sumCents([line.unitPriceCents, ...line.modifierPriceCents]);
  const total = unit * line.quantity;
  assertCents(total);
  return total;
}

/** Order totals (CUS-07). Locked onto the order at placement. */
export function orderTotals(input: {
  lines: readonly PricedLine[];
  deliveryFeeCents: Cents;
  restaurantFeeCents?: Cents;
}): OrderTotals {
  if (input.lines.length === 0) throw new RangeError('An order needs at least one line');
  const itemsCents = sumCents(input.lines.map(lineTotal));
  const restaurantFeeCents = input.restaurantFeeCents ?? 0;
  return {
    itemsCents,
    deliveryFeeCents: input.deliveryFeeCents,
    restaurantFeeCents,
    totalCents: sumCents([itemsCents, input.deliveryFeeCents, restaurantFeeCents]),
  };
}
