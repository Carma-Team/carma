/**
 * @fileoverview Active-trip state shape, shared by the provider and its SDK bindings
 * @module context/tripState
 *
 * @description
 * Deliberately outside AppContext.tsx. The binding modules are imported *by* the
 * provider, so importing `INITIAL_TRIP_STATE` back out of it would form a cycle —
 * and because it is a value rather than a type, it would not be erased at compile
 * time: one of the two modules would read `undefined` during module init, in an
 * order that can differ between the dev bundle and a release build.
 *
 * Owner: shared. May writes the SDK-fed fields, Dan the scoring counters.
 */
export interface TripState {
  isActive: boolean;
  sessionId: string;
  startTime: Date | null;
  durationSeconds: number;
  distanceKm: number;
  currentSpeedKmH: number;
  screenInteractionSeconds: number; // v2.0 — seconds with a tap cadence, at ≥15 km/h
  phoneMotionSeconds: number;       // v2.0 — seconds the phone was moved without one, at ≥15 km/h
  eventCounts: {
    HARD_BRAKE: number;
    AGGRESSIVE_ACCEL: number;
    SHARP_TURN: number;
    SWERVE: number;
  };
}

export const INITIAL_TRIP_STATE: TripState = {
  isActive: false,
  sessionId: '',
  startTime: null,
  durationSeconds: 0,
  distanceKm: 0,
  currentSpeedKmH: 0,
  screenInteractionSeconds: 0,
  phoneMotionSeconds: 0,
  eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, SWERVE: 0 },
};
