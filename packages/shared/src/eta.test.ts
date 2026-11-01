import { describe, expect, it } from 'vitest';
import { estimateDeliveryRange, haversineMeters } from './eta.js';

describe('haversineMeters', () => {
  it('measures short town distances', () => {
    // About 1.1 km between two points 0.01 degrees of latitude apart.
    expect(haversineMeters({ lat: 7.049, lng: 80.534 }, { lat: 7.059, lng: 80.534 })).toBe(1112);
    expect(haversineMeters({ lat: 7, lng: 80 }, { lat: 7, lng: 80 })).toBe(0);
  });
});

describe('estimateDeliveryRange', () => {
  it('gives a 10-minute range rounded to 5', () => {
    // 20 prep + 2 km at 20 km/h (6 min) + 5 handover = 31 -> 25..35
    expect(estimateDeliveryRange(20, 2000)).toEqual({ min: 25, max: 35 });
    expect(estimateDeliveryRange(15, 0)).toEqual({ min: 15, max: 25 });
  });

  it('never starts below 10 minutes', () => {
    expect(estimateDeliveryRange(0, 0).min).toBe(10);
  });
});
