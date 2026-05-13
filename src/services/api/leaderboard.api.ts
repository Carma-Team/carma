import { request } from './client';
import { LeaderboardEntry } from '@/navigation/types';

export const leaderboardApi = {
  get: (type: 'national' | 'city' | 'friends') =>
    request<{ entries: LeaderboardEntry[], currentUserId: string }>(`/api/leaderboard?type=${type}`, { public: true }),
};
