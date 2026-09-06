import { request } from './client';
import type { LeaderboardOut } from '@/types';
import type { components } from './generated';

// Aliased from the generated schema, not hand-written: the old local interface
// kept compiling for a full release after the server shape changed (CAR-218).
export type LocationsOut = components['schemas']['LocationsOut'];
export type CitiesOut = components['schemas']['CitiesOut'];

// Friend requests, unfriending and blocking live in friends.api.ts — this module
// is only the board itself.
export const leaderboardApi = {
  get: (type: 'national' | 'city' | 'friends', filters?: { cityCode?: string }) => {
    const params = new URLSearchParams({ type });
    if (filters?.cityCode) params.set('cityCode', filters.cityCode);
    return request<LeaderboardOut>(`/api/leaderboard?${params.toString()}`);
  },

  getLocations: () => request<LocationsOut>('/api/leaderboard/locations'),

  // Public on purpose: registration reads it before a token exists (CAR-224).
  getCities: () => request<CitiesOut>('/api/cities'),
};
