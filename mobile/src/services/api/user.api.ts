/**
 * @fileoverview User profile and driving stats API
 * @module services/api/user
 *
 * @description
 * - `stats` — cumulative driving statistics (trips, distance, avg score, weekly chart)
 * - `updateProfile` — update name, language, age, city
 * - `deleteAccount` — delete account (GDPR)
 * - `searchByPhone` — find a driver to send a friend request to
 * - `matchContacts` — which of the user's contacts already drive with CARMA
 *
 * @server
 * - GET /api/user/stats — USE_REAL_SERVER=false → mock (MOCK_STATS/MOCK_DRIVER_STATS); true → real server
 * - PATCH /api/users/me — USE_REAL_SERVER=false → mock; true → real server
 * - DELETE /api/users/me — USE_REAL_SERVER=false → mock (204); true → real server
 * - GET /api/users/search?phone= — real server
 * - POST /api/users/match-contacts — real server
 */
import { request } from './client';
import type { AppUser, ContactMatch, DrivingStats } from '@/types';

export interface UpdateProfilePayload {
  name?: string;
  language?: string;
  age?: number;
  city?: string;
  isPrivate?: boolean;
  driveModeEnabled?: boolean;
  bluetoothDeviceId?: string | null;
  bluetoothDeviceName?: string | null;
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

  /** Find a driver by their phone number (excludes the current user) */
  searchByPhone: (phone: string) =>
    request<{ user: FoundUser }>(`/api/users/search?phone=${encodeURIComponent(phone)}`),

  /**
   * Which of the user's contacts are CARMA drivers.
   *
   * Send SHA-256 hex digests, never raw numbers. Each digest must be taken over
   * the number in E.164 — strip everything but digits and `+`, then turn a
   * leading `0` into `+972` (see canonical_phone on the server; the two must
   * agree exactly or nothing matches). Max 1000 per call — page a longer book.
   */
  matchContacts: (phoneHashes: string[]) =>
    request<{ matches: ContactMatch[] }>('/api/users/match-contacts', {
      method: 'POST',
      body: JSON.stringify({ phoneHashes }),
    }),
};
