/**
 * @fileoverview API לטבלת הדירוג
 * @module services/api/leaderboard
 *
 * @description
 * - `get(type)` — שליפת דירוג לפי סוג: 'national' | 'city' | 'friends'
 *   מחזיר רשימת entries וה-ID של המשתמש הנוכחי (לצביעה)
 *
 * @server
 * - GET /api/leaderboard?type=... — USE_REAL_SERVER=false → mock; true → שרת נווה
 */
import { request } from './client';
import type { LeaderboardEntry } from '@/types';

export const leaderboardApi = {
  get: (type: 'national' | 'city' | 'friends') =>
    request<{ entries: LeaderboardEntry[]; currentUserId: string }>(
      `/api/leaderboard?type=${type}`
    ),
};
