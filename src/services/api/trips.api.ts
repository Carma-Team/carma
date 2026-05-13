import { request } from './client';
import { Trip } from '@/navigation/types';

// ממיר תגובת שרת (camelCase) לפורמט הפנימי של האפליקציה (snake_case)
function normalizeTrip(raw: any): Trip {
  return {
    ...raw,
    user_id:      raw.user_id      ?? raw.userId      ?? '',
    start_time:   raw.start_time   ?? raw.startTime   ?? '',
    end_time:     raw.end_time     ?? raw.endTime,
    avg_score:    raw.avg_score    ?? raw.avgScore     ?? 0,
    distance:     raw.distance     ?? raw.distanceKm   ?? 0,
    events_array: raw.events_array ?? raw.events       ?? [],
  };
}

export const tripsApi = {
  /** 5.3.1.2 Trip - קבלת כל הנסיעות של המשתמש */
  list: async () => {
    const res = await request<{ trips: any[] }>('/api/trips');
    return { trips: res.trips.map(normalizeTrip) };
  },

  /** שמירת נסיעה חדשה בסיום */
  save: (tripData: Partial<Trip>) =>
    request<Trip>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(tripData),
    }),

  /** קבלת נתוני נסיעה ספציפית */
  getById: async (id: string) => {
    const res = await request<{ trip: any }>(`/api/trips/${id}`);
    return { trip: normalizeTrip(res.trip) };
  },
};
