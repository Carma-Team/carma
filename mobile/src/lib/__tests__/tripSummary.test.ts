import { fromLocalTrip, fromServerTrip, TOO_SHORT_SUMMARY } from '@/lib/tripSummary';
import type { Trip } from '@/types';
import type { TripData } from '@/lib/driving-sdk/types';

const saved = { id: 's1', avgScore: 84, points: 12.6, effectiveRiskMultiplier: 1.25, pointsCapped: true } as Trip;
const local = { distanceKm: 4.2, durationSeconds: 600 };

describe('tripSummary', () => {
  it('reports a saved trip as scored, with the server numbers', () => {
    const s = fromLocalTrip('s1', saved, local, null);
    expect(s.state).toBe('scored');
    expect(s.score).toBe(84);
    expect(s.points).toBe(13);
  });

  // The whole point of the state field: no answer from the server is not a zero.
  it('reports an unsaved trip as pending, keeping the device measurements', () => {
    const s = fromLocalTrip('local-1', null, local, null);
    expect(s.state).toBe('pending');
    expect(s.distanceKm).toBe(4.2);
    expect(s.durationSeconds).toBe(600);
  });

  it('carries route and events from device memory', () => {
    const tripData = { waypoints: [{ lat: 1, lng: 2, ts: 0, speedKmh: 30 }], events: [] } as unknown as TripData;
    expect(fromLocalTrip('s1', saved, local, tripData).routeWaypoints).toHaveLength(1);
  });

  it('keeps a queued trip pending when read back out of history', () => {
    const row = { ...saved, avgScore: 0, points: 0, pendingSync: true } as Trip;
    expect(fromServerTrip(row, [], []).state).toBe('pending');
    expect(fromServerTrip({ ...row, pendingSync: undefined } as Trip, [], []).state).toBe('scored');
  });

  it('has nothing to open for a trip that was never saved', () => {
    expect(TOO_SHORT_SUMMARY.id).toBeUndefined();
  });
});
