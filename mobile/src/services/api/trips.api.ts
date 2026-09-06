/**
 * @fileoverview Trips API
 * @module services/api/trips
 *
 * @description
 * - `list` — fetch the user's trip list
 * - `save` — persist a completed trip (called from SyncManager.flushQueue)
 * - `getById` — fetch a single trip's full detail
 *
 * @server
 * - GET /api/trips
 * - POST /api/trips — answers with the saved trip, carrying its server id
 * - GET /api/trips/:id
 */
import { request } from './client';
import type { Trip, TripDetail } from '@/types';
import type { ValidTripPayload } from '@/services/sync/types';

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
};
