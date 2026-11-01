/**
 * Money is integer cents (LKR minor units): 1 rupee = 100 cents. Never use floats for amounts.
 */
export type Cents = number;

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Expected an integer number of cents, got ${value}`);
  }
}

/** Converts a rupee amount (e.g. from a settings form) to cents. Rejects fractions of a cent. */
export function rupees(amount: number): Cents {
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - cents) > 1e-6) {
    throw new RangeError(`${amount} is not a whole number of cents`);
  }
  assertCents(cents);
  return cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  assertCents(total);
  return total;
}

/** Formats as shown in the design: "LKR 1,350", or "LKR 1,350.50" when there are cents. */
export function formatLkr(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = abs % 100;
  const suffix = fraction === 0 ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${sign}LKR ${whole}${suffix}`;
}
