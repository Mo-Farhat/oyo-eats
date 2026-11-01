import { haversineMeters } from '@oyo/shared';
import type { Point, Routing } from './routing.js';

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 5_000;

/**
 * Google Routes API road distance (NFR-14): one provider for fees and ETAs. Results are cached
 * for 10 minutes per pair of points (rounded to ~10 m) to keep listing pages cheap. If Google is
 * unreachable it falls back to straight-line x 1.3 and logs, so ordering never stops.
 */
export class GoogleRouting implements Routing {
  private readonly cache = new Map<string, { meters: number; at: number }>();

  constructor(
    private readonly apiKey: string,
    private readonly doFetch: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async routeMeters(from: Point, to: Point): Promise<number> {
    const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(',');
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.meters;

    let meters: number;
    try {
      const res = await this.doFetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: 'DRIVE',
        }),
        signal: AbortSignal.timeout(4000),
      });
      const body = (await res.json()) as { routes?: { distanceMeters?: number }[] };
      const d = body.routes?.[0]?.distanceMeters;
      if (!res.ok || typeof d !== 'number') throw new Error(`HTTP ${res.status}`);
      meters = d;
    } catch (error) {
      console.warn(`Google Routes unavailable, using straight-line estimate: ${String(error)}`);
      return Math.round(haversineMeters(from, to) * 1.3);
    }

    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { meters, at: this.now() });
    return meters;
  }
}
