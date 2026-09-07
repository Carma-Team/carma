/**
 * @fileoverview Trips API
 * @module services/api/trips
 *
 * @description
 * - `list` — fetch the user's trip list
 * - `save` — persist a completed trip (called from SyncManager.flushQueue)
 * - `getById` — fetch a single trip's full detail
 * - `occupancy` / `declareOccupancy` — who was behind the wheel on a trip
 *
 * @server
 * - GET /api/trips
 * - POST /api/trips — answers with the saved trip, carrying its server id
 * - GET /api/trips/:id
 * - GET /api/trips/:id/occupancy
 * - POST /api/trips/:id/occupancy
 */
import { request } from './client';
import type { components } from './generated';
import type { Trip, TripDetail } from '@/types';
import type { ValidTripPayload } from '@/services/sync/types';

/**
 * Who the server believes was driving. `UNKNOWN` is the ordinary state of a trip
 * nobody has said anything about, not missing data.
 */
export type OccupancyVerdict = components['schemas']['OccupancyVerdict'];

/** `excludedFromDriverScore` is the server's own answer — only it knows what the score counts. */
export type Occupancy = components['schemas']['OccupancyOut'];

export const tripsApi = {
  list: () => request<{ trips: Trip[] }>('/api/trips'),

  save: (payload: ValidTripPayload): Promise<Trip> => {
    const { localTripId, ...body } = payload;
    return request<Trip>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': localTripId },
    });
  },

  getById: (id: string) => request<{ trip: TripDetail }>(`/api/trips/${id}`),

  occupancy: (id: string) => request<Occupancy>(`/api/trips/${id}/occupancy`),

  /**
   * `prompted` separates a driver who volunteered this from one answering a prompt we
   * raised, because the two are not equally strong evidence about the same trip. Nothing
   * raises a prompt yet — the flag-driven one arrives with the matcher in phase 3.
   */
  declareOccupancy: (id: string, wasDriving: boolean, prompted: boolean) =>
    request<Occupancy>(`/api/trips/${id}/occupancy`, {
      method: 'POST',
      body: JSON.stringify({ wasDriving, prompted }),
    }),
};
