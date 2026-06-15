/**
 * @fileoverview Rewards and vouchers API — Marketplace
 * @module services/api/rewards
 *
 * @description
 * - `list` — fetch active rewards + user vouchers (with optional category filter)
 * - `redeem` — redeem a reward: deducts points and creates a new voucher
 * - `myVouchers` — fetch only the current user's vouchers
 *
 * @server
 * - GET /api/rewards — USE_REAL_SERVER=false → mock; true → real server
 * - POST /api/rewards/:id/redeem — USE_REAL_SERVER=false → mock; true → real server
 * - GET /api/vouchers — USE_REAL_SERVER=false → mock; true → real server
 */
import { request } from './client';
import { Reward, Voucher } from '@/types';

export const rewardsApi = {
  /** 5.3.1.3 & 5.3.1.4 Reward & Businesses — public reward list with optional category filter */
  list: (category?: string) =>
    request<{ rewards: Reward[], vouchers: Voucher[] }>(
      `/api/rewards${category && category !== 'all' ? `?category=${category}` : ''}`
    ),

  /** 5.3.1.5 Redemption — redeem a reward */
  redeem: (rewardId: string) =>
    request<{ voucher: Voucher }>(`/api/rewards/${rewardId}/redeem`, {
      method: 'POST'
    }),

  /** Fetch the current user's personal vouchers */
  myVouchers: () => request<{ vouchers: Voucher[] }>('/api/vouchers'),
};
