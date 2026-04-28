import { request } from './client';

export const notificationsApi = {
  /** קבלת רשימת התראות למשתמש */
  list: () => request<any[]>('/api/notifications'),
};
