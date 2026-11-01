/** Straight-line distance in metres between two WGS84 points (haversine). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const RIDER_KMH = 20; // town riding with stops
const HANDOVER_MINUTES = 5;

/**
 * Door-time estimate shown on Home and the restaurant page (CUS-03): prep, plus riding the route,
 * plus handover, as a 10-minute range rounded to 5 ("25–35 min"). A guide, not a promise.
 */
export function estimateDeliveryRange(
  prepMinutes: number,
  routeMeters: number,
): { min: number; max: number } {
  const ride = (routeMeters / 1000 / RIDER_KMH) * 60;
  const mid = prepMinutes + ride + HANDOVER_MINUTES;
  const min = Math.max(10, Math.round((mid - 5) / 5) * 5);
  return { min, max: min + 10 };
}
