/**
 * @fileoverview API לניהול נסיעות
 * @module services/api/trips
 *
 * @description
 * - `list` — שליפת רשימת נסיעות המשתמש
 * - `save` — שמירת נסיעה שהסתיימה (נקרא מ-AppContext.processEndTrip)
 * - `getById` — שליפת פרטי נסיעה בודדת
 *
 * @server
 * - GET /api/trips — USE_REAL_SERVER=false → mock; true → שרת נווה
 * - POST /api/trips — USE_REAL_SERVER=false → mock (מחזיר trip עם ID ייחודי); true → שרת נווה
 * - GET /api/trips/:id — USE_REAL_SERVER=false → mock; true → שרת נווה
 */
import { request } from './client';
import type { Trip } from '@/types';

// שדות שנשלחים לשרת בשמירת נסיעה — נגזרים מ-Trip כדי שלא יסטו
export type SaveTripPayload = Partial<Pick<Trip,
  | 'startTime'
  | 'endTime'
  | 'distanceKm'
  | 'avgScore'
  | 'durationSeconds'
  | 'points'
  | 'hardBrakes'
  | 'aggressiveAccels'
  | 'sharpTurns'
  | 'phoneSeconds'
>>;

export const tripsApi = {
  list: () => request<{ trips: Trip[] }>('/api/trips'),

  save: (payload: SaveTripPayload) =>
    request<Trip>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getById: (id: string) => request<{ trip: Trip }>(`/api/trips/${id}`),
};
