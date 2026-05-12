import { request } from './client';
import { Reward, Voucher } from '@/navigation/types';

export const rewardsApi = {
  /** 5.3.1.3 & 5.3.1.4 Reward & Businesses - רשימת הטבות עם סינון קטגוריה (ציבורי) */
  list: (category?: string) =>
    request<{ rewards: Reward[], vouchers: Voucher[] }>(
      `/api/rewards${category && category !== 'all' ? `?category=${category}` : ''}`,
      { public: true }
    ),

  /** 5.3.1.5 Redemption - מימוש הטבה */
  redeem: (rewardId: string) =>
    request<{ voucher: Voucher }>(`/api/rewards/${rewardId}/redeem`, {
      method: 'POST'
    }),

  /** קבלת השוברים האישיים של המשתמש */
  myVouchers: () => request<{ vouchers: Voucher[] }>('/api/vouchers'),
};
