import { assertCents, type Cents } from './money.js';
import type { DeliveryFeeSettings } from './settings.js';

function assertMeters(meters: number): void {
  if (!Number.isSafeInteger(meters) || meters < 0) {
    throw new RangeError(`Expected a non-negative whole number of meters, got ${meters}`);
  }
}

/**
 * Delivery fee = base + per-km rate x road-route distance, pro rata for part kilometres,
 * rounded half up to a whole rupee. The distance must come from the server's routing call
 * (one provider, NFR-14), never from the client.
 */
export function deliveryFee(routeDistanceMeters: number, settings: DeliveryFeeSettings): Cents {
  assertMeters(routeDistanceMeters);
  assertCents(settings.baseFeeCents);
  assertCents(settings.perKmCents);
  // Work in thousandths of a cent so the per-metre part stays an integer.
  const milliCents = settings.baseFeeCents * 1000 + settings.perKmCents * routeDistanceMeters;
  const fee = Math.floor((milliCents + 50_000) / 100_000) * 100;
  assertCents(fee);
  return fee;
}

/** Whether a customer location is inside the delivery radius of a restaurant (CUS-03). */
export function isWithinDeliveryRadius(
  distanceMeters: number,
  settings: Pick<DeliveryFeeSettings, 'maxRadiusMeters'>,
): boolean {
  assertMeters(distanceMeters);
  return distanceMeters <= settings.maxRadiusMeters;
}
