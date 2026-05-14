/**
 * @fileoverview API להטבות ושוברים — Marketplace
 * @module services/api/rewards
 *
 * @description
 * - `list` — שליפת הטבות פעילות + שוברי המשתמש (עם סינון קטגוריה אופציונלי)
 * - `redeem` — מימוש הטבה: מנכה נקודות ויוצר שובר חדש
 * - `myVouchers` — שליפת השוברים של המשתמש בלבד
 *
 * @server
 * - GET /api/rewards — USE_REAL_SERVER=false → mock; true → שרת נווה
 * - POST /api/rewards/:id/redeem — USE_REAL_SERVER=false → mock; true → שרת נווה
 * - GET /api/vouchers — USE_REAL_SERVER=false → mock; true → שרת נווה
 */
import { request } from './client';
import { Reward, Voucher } from '@/types';

export const rewardsApi = {
  /** 5.3.1.3 & 5.3.1.4 Reward & Businesses - רשימת הטבות עם סינון קטגוריה (ציבורי) */
  list: (category?: string) =>
    request<{ rewards: Reward[], vouchers: Voucher[] }>(
      `/api/rewards${category && category !== 'all' ? `?category=${category}` : ''}`
    ),

  /** 5.3.1.5 Redemption - מימוש הטבה */
  redeem: (rewardId: string) =>
    request<{ voucher: Voucher }>(`/api/rewards/${rewardId}/redeem`, {
      method: 'POST'
    }),

  /** קבלת השוברים האישיים של המשתמש */
  myVouchers: () => request<{ vouchers: Voucher[] }>('/api/vouchers'),
};
