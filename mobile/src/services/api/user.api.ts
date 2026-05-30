/**
 * @fileoverview API לפרופיל משתמש וסטטיסטיקות נהיגה
 * @module services/api/user
 *
 * @description
 * - `stats` — סטטיסטיקות נהיגה מצטברות (נסיעות, מרחק, ציון ממוצע, גרף שבועי)
 * - `updateProfile` — עדכון שם, שפה, גיל, עיר
 * - `deleteAccount` — מחיקת חשבון (GDPR)
 *
 * @server
 * - GET /api/user/stats — USE_REAL_SERVER=false → mock (MOCK_STATS/MOCK_DRIVER_STATS); true → שרת נווה
 * - PATCH /api/users/me — USE_REAL_SERVER=false → mock; true → שרת נווה
 * - DELETE /api/users/me — USE_REAL_SERVER=false → mock (204); true → שרת נווה
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
};
