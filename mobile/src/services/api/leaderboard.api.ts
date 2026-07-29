import { request } from './client';
import type { LeaderboardOut } from '@/types';

export interface LocationsOut {
  countries: string[];
  citiesByCountry: Record<string, string[]>;
}

// Friend requests, unfriending and blocking live in friends.api.ts — this module
// is only the board itself.
export const leaderboardApi = {
  get: (type: 'national' | 'city' | 'friends', filters?: { city?: string; country?: string }) => {
    const params = new URLSearchParams({ type });
    if (filters?.city)    params.set('city',    filters.city);
    if (filters?.country) params.set('country', filters.country);
    return request<LeaderboardOut>(`/api/leaderboard?${params.toString()}`);
  },

  getLocations: () => request<LocationsOut>('/api/leaderboard/locations'),
};
