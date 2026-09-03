/**
 * @file tripSummary.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief One shape for the end-of-trip summary, built either from the device's own
 * trip data or from a trip the server returned. Both summary surfaces render this
 * shape, so neither can show a field the other does not.
 *
 * @description
 * The post-trip modal reads live SDK memory while the trip-detail screen reads the
 * server, which is how an event that never reached the server stayed visible in one
 * place and vanished from the other (CAR-225). Normalising here is what makes the
 * two paths comparable at all.
 */
import type { DrivingEvent, RouteWaypoint, TripData } from '@/lib/driving-sdk/types';
import type { Trip } from '@/types';

/**
 * `pending` is not a score of zero. The server is the only scoring oracle, so with
 * no answer from it there is no score to render — and rendering 0 told the driver
 * they drove badly when the app simply had no network.
 */
export type TripSummaryState = 'scored' | 'pending' | 'tooShort';

export interface TripSummary {
  id?: string;
  state: TripSummaryState;
  score: number;
  points: number;
  distanceKm: number;
  durationSeconds: number;
  effectiveRiskMultiplier: number;
  pointsCapped: boolean;
  routeWaypoints: RouteWaypoint[];
  events: DrivingEvent[];
}

/** No id and no numbers: the trip was never saved, so there is nothing to open later. */
export const TOO_SHORT_SUMMARY: TripSummary = {
  state: 'tooShort',
  score: 0,
  points: 0,
  distanceKm: 0,
  durationSeconds: 0,
  effectiveRiskMultiplier: 1,
  pointsCapped: false,
  routeWaypoints: [],
  events: [],
};

/**
 * Just-ended trip. Numbers come from the server's answer, route and events from the
 * device — the device is the only holder of those until the save lands, and it stays
 * the better source even afterwards (the server timeline carries neither speed nor
 * peak-g per event).
 */
export function fromLocalTrip(
  id: string,
  savedTrip: Trip | null,
  local: { distanceKm: number; durationSeconds: number },
  tripData: TripData | null,
): TripSummary {
  return {
    id,
    state: savedTrip ? 'scored' : 'pending',
    score:  savedTrip?.avgScore ?? 0,
    points: Math.round(savedTrip?.points ?? 0),
    distanceKm:      local.distanceKm,
    durationSeconds: local.durationSeconds,
    effectiveRiskMultiplier: savedTrip?.effectiveRiskMultiplier ?? savedTrip?.riskMultiplier ?? 1,
    pointsCapped:            savedTrip?.pointsCapped ?? false,
    routeWaypoints: tripData?.waypoints ?? [],
    events:         tripData?.events ?? [],
  };
}

/**
 * A trip out of history. Waypoints and events arrive separately because the list
 * endpoint returns neither — only GET /api/trips/:id does.
 *
 * `pendingSync` is the only thing separating a real zero from an unsent trip: the
 * locally-created row fills the required score fields with zeros, so without the
 * flag this screen would repeat exactly the lie the modal no longer tells.
 */
export function fromServerTrip(
  trip: Trip,
  routeWaypoints: RouteWaypoint[],
  events: DrivingEvent[],
): TripSummary {
  return {
    id: trip.id,
    state: trip.pendingSync ? 'pending' : 'scored',
    score:  trip.avgScore,
    points: Math.round(trip.points || 0),
    distanceKm:      trip.distanceKm ?? 0,
    durationSeconds: trip.durationSeconds ?? 0,
    effectiveRiskMultiplier: trip.effectiveRiskMultiplier ?? trip.riskMultiplier ?? 1,
    pointsCapped:            trip.pointsCapped ?? false,
    routeWaypoints,
    events,
  };
}
