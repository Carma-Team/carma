import { toDrivingEvents } from '@/lib/tripEvents';
import { DrivingEventType } from '@/lib/driving-sdk/types';
import type { TripEvent } from '@/types';

const event = (over: Partial<TripEvent> = {}): TripEvent => ({
  id: 'e1',
  type: 'hard_brake',
  severity: 2.4,
  timestamp: '2026-08-23T10:00:00Z',
  lat: 32.08,
  lng: 34.78,
  ...over,
});

describe('toDrivingEvents', () => {
  it('upper-cases the wire type into the SDK enum', () => {
    expect(toDrivingEvents([event()])[0].type).toBe(DrivingEventType.HARD_BRAKE);
  });

  // The silent one: an unmapped type is dropped rather than passed through, so a
  // marker that never appears has to be distinguishable from one that never fired.
  it('drops an event whose type the SDK has no marker for', () => {
    expect(toDrivingEvents([event({ type: 'not_a_real_event' })])).toEqual([]);
  });

  // CAR-210. The field is optional on DrivingEvent, so a wrong value here compiles
  // and reads back as a plausible number — nothing but this assertion catches it.
  it('leaves severity unset — the server sends 1-3, the SDK field means 0-1', () => {
    expect(toDrivingEvents([event()])[0].severity).toBeUndefined();
  });

  it('nests flat coordinates under location', () => {
    expect(toDrivingEvents([event()])[0].location).toEqual({ latitude: 32.08, longitude: 34.78 });
  });

  it('leaves location undefined when the event was detected in a GPS gap', () => {
    expect(toDrivingEvents([event({ lat: null, lng: null })])[0].location).toBeUndefined();
  });

  it('returns an empty list for a trip the server sent no events for', () => {
    expect(toDrivingEvents(undefined)).toEqual([]);
  });
});
