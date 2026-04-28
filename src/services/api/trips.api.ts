import { request } from './client';
import { Trip } from '@/navigation/types';

export const tripsApi = {
  /** 5.3.1.2 Trip - קבלת כל הנסיעות של המשתמש */
  list: () => request<{ trips: Trip[] }>('/api/trips'),

  /** שמירת נסיעה חדשה בסיום */
  save: (tripData: Partial<Trip>) =>
    request<Trip>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(tripData),
    }),

  /** קבלת נתוני נסיעה ספציפית */
  getById: (id: string) => request<{ trip: Trip }>(`/api/trips/${id}`),
};
