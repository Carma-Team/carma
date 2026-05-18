/**
 * @fileoverview API לניהול נסיעות
 * @module services/api/trips
 *
 * @description
 * - `list` — שליפת רשימת נסיעות המשתמש
 * - `save` — שמירת נסיעה שהסתיימה (נקרא מ-SyncManager.flushQueue)
 * - `getById` — שליפת פרטי נסיעה בודדת
 *
 * @server
 * - GET /api/trips — USE_REAL_SERVER=false → mock; true → שרת נווה
 * - POST /api/trips — USE_REAL_SERVER=false → mock (מחזיר trip עם ID ייחודי); true → שרת נווה
 * - GET /api/trips/:id — USE_REAL_SERVER=false → mock; true → שרת נווה
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
