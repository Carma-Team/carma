/**
 * @fileoverview User profile and driving stats API
 * @module services/api/user
 *
 * @description
 * - `stats` — cumulative driving statistics (trips, distance, avg score, weekly chart)
 * - `updateProfile` — update name, language, age, city
 * - `deleteAccount` — delete account (GDPR)
 *
 * @server
 * - GET /api/user/stats — USE_REAL_SERVER=false → mock (MOCK_STATS/MOCK_DRIVER_STATS); true → real server
 * - PATCH /api/users/me — USE_REAL_SERVER=false → mock; true → real server
 * - DELETE /api/users/me — USE_REAL_SERVER=false → mock (204); true → real server
 */
import { request } from './client';
import type { AppUser, DrivingStats } from '@/types';

export interface UpdateProfilePayload {
  name?: string;
  language?: string;
  age?: number;
  city?: string;
  isPrivate?: boolean;
}

export interface FoundUser {
  id: string;
  name: string;
  city: string | null;
}

export const userApi = {
  /** Aggregate driving stats for the authenticated user */
  stats: () => request<{ stats: DrivingStats }>('/api/user/stats'),

  /** Update profile fields (name, language, age, city) */
  updateProfile: (payload: UpdateProfilePayload) =>
    request<AppUser>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Delete account (GDPR right to be forgotten) */
  deleteAccount: () =>
    request<void>('/api/users/me', { method: 'DELETE' }),

  /** Find a user by their phone number (excludes the current user) */
  searchByPhone: (phone: string) =>
    request<{ user: FoundUser }>(`/api/users/search?phone=${encodeURIComponent(phone)}`),

  /** Send a friend request to targetUserId */
  sendFriendRequest: (targetUserId: string) =>
    request<{ status: string }>(`/api/users/${targetUserId}/friend-request`, { method: 'POST' }),
};
