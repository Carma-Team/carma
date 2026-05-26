import { request } from './client';
import type { FollowRequest, FollowStatus, LeaderboardOut } from '@/types';

export const leaderboardApi = {
  get: (type: 'national' | 'city' | 'friends') =>
    request<LeaderboardOut>(`/api/leaderboard?type=${type}`),

  getFollowStatus: (targetId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/follow/${targetId}`),

  follow: (targetId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/follow/${targetId}`, { method: 'POST' }),

  unfollow: (targetId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/follow/${targetId}`, { method: 'DELETE' }),

  // Incoming follow requests (private accounts)
  listRequests: () =>
    request<FollowRequest[]>('/api/leaderboard/requests'),

  acceptRequest: (followerId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/requests/${followerId}/accept`, { method: 'POST' }),

  rejectRequest: (followerId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/requests/${followerId}`, { method: 'DELETE' }),

  // Block / Unblock
  block: (targetId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/block/${targetId}`, { method: 'POST' }),

  unblock: (targetId: string) =>
    request<{ status: FollowStatus }>(`/api/leaderboard/block/${targetId}`, { method: 'DELETE' }),
};
