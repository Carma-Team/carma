import { request } from './client';

export const userApi = {
  /** 5.3.1.1 - קבלת סטטיסטיקות משתמש */
  stats: () => request<any>('/api/user/stats'),
};
