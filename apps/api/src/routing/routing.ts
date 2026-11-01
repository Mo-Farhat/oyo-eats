import { haversineMeters } from '@oyo/shared';

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Road distance for fees and ETAs. One provider for both, so the fee shown equals the fee
 * charged (NFR-14). Only the server calls it.
 */
export interface Routing {
  routeMeters(from: Point, to: Point): Promise<number>;
}

/**
 * Placeholder until the Google Routes API key exists (docs/NEEDS-YOU.md): straight-line
 * distance x 1.3, a common road-to-crow ratio for towns.
 */
export class StraightLineRouting implements Routing {
  async routeMeters(from: Point, to: Point): Promise<number> {
    return Math.round(haversineMeters(from, to) * 1.3);
  }
}
