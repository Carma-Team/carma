/**
 * @fileoverview API להתראות ועדכונים
 * @module services/api/notifications
 *
 * @description
 * - `list` — שליפת רשימת ההתראות של המשתמש
 *
 * @server
 * - GET /api/notifications — USE_REAL_SERVER=false → mock (רשימה ריקה מהשרת המקומי); true → שרת נווה
 */
import { request } from './client';
import type { Notification } from '@/types';

export const notificationsApi = {
  list: () => request<Notification[]>('/api/notifications'),
};
