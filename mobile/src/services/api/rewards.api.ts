/**
 * @fileoverview Rewards and vouchers API — Marketplace
 * @module services/api/rewards
 *
 * @description
 * - `list` — fetch active rewards + user vouchers (with optional category filter)
 * - `redeem` — redeem a reward: reserves points and creates a new voucher
 * - `cancel` — cancel a voucher the driver no longer wants, releasing its reserved points
 *
 * @server
 * - GET /api/rewards — USE_REAL_SERVER=false → mock; true → real server
 * - POST /api/rewards/:id/redeem — USE_REAL_SERVER=false → mock; true → real server
 * - POST /api/vouchers/:id/cancel — USE_REAL_SERVER=false → mock; true → real server
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

  /** Cancel a voucher — the server releases the points it held reserved */
  cancel: (voucherId: string) =>
    request<{ voucher: Voucher }>(`/api/vouchers/${voucherId}/cancel`, {
      method: 'POST'
    }),
};
