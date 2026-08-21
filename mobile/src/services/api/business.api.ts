/**
 * @fileoverview Rewards API for business users
 * @module services/api/business
 *
 * @description
 * Endpoints available only to users with role='business' (server validates businessId).
 * - `getRewards` — fetch the business's reward list
 * - `addReward` — add a new reward
 * - `updateReward` — update an existing reward
 * - `deleteReward` — delete a reward (server returns 204)
 *
 * @server
 * - GET/POST/PATCH/DELETE /api/business/rewards — implemented on FastAPI
 *   (server/app/routers/business.py). Scoped to the caller's own business;
 *   DELETE archives the reward (CAR-111) rather than removing it — it always
 *   succeeds, even once a voucher has been issued.
 */
import { request } from './client';

export interface BusinessReward {
  id: string;
  businessId: string;
  business: string;
  businessHe?: string | null;
  titleHe: string;
  titleEn?: string | null;
  descriptionHe: string;
  descriptionEn?: string | null;
  category: string;
  costPoints: number;
  imageIcon: string;
  isActive: boolean;
  // null means no cap was set. See the note on `Reward` in types/index.ts.
  stock: number | null;
  available: number | null;
  expiresAt?: string | null;
}

// `available` is derived from the redemptions ledger, so the server owns it and
// a client never sends one.
export type NewBusinessReward = Omit<BusinessReward, 'id' | 'businessId' | 'business' | 'available'>;

export const businessApi = {
  getRewards: async (): Promise<BusinessReward[]> => {
    const res = await request<{ rewards: BusinessReward[] }>('/api/business/rewards');
    return res.rewards;
  },

  addReward: async (data: NewBusinessReward): Promise<BusinessReward> => {
    const res = await request<{ reward: BusinessReward }>('/api/business/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.reward;
  },

  updateReward: async (id: string, data: Partial<NewBusinessReward>): Promise<BusinessReward> => {
    const res = await request<{ reward: BusinessReward }>(`/api/business/rewards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return res.reward;
  },

  deleteReward: async (id: string): Promise<void> => {
    await request<void>(`/api/business/rewards/${id}`, { method: 'DELETE' });
  },
};
