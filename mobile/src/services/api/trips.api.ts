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
 * - GET /api/trips — USE_REAL_SERVER=false → mock; true → real server
 * - POST /api/trips — USE_REAL_SERVER=false → mock (returns trip with unique ID); true → real server
 * - GET /api/trips/:id — USE_REAL_SERVER=false → mock; true → real server
 */
import { request } from './client';
import type { Trip } from '@/types';
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

  getById: (id: string) => request<{ trip: Trip }>(`/api/trips/${id}`),
};
