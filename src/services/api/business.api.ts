/**
 * @fileoverview API לניהול הטבות עבור משתמשי עסק
 * @module services/api/business
 *
 * @description
 * נתיבים המיועדים למשתמש עם role='business' בלבד (השרת מאמת businessId).
 * - `getRewards` — שליפת ההטבות של העסק
 * - `addReward` — הוספת הטבה חדשה
 * - `updateReward` — עדכון הטבה קיימת
 * - `deleteReward` — מחיקת הטבה (שרת מחזיר 204)
 *
 * @server
 * - GET/POST/PATCH/DELETE /api/business/rewards — אינו מיורט ב-mock interceptor.
 *   USE_REAL_SERVER=false → שרת מקומי (carma-local-server, db.json)
 *   USE_REAL_SERVER=true  → שרת נווה
 */
import { request } from './client';

export interface BusinessReward {
  id: string;
  businessId: string;
  business: string;
  titleHe: string;
  titleEn?: string | null;
  descriptionHe: string;
  descriptionEn?: string | null;
  category: string;
  costPoints: number;
  imageEmoji: string;
  isActive: boolean;
  stock: number;
  expiresAt?: string | null;
}

export type NewBusinessReward = Omit<BusinessReward, 'id' | 'businessId' | 'business'>;

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
