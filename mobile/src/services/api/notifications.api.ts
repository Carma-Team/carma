/**
 * @fileoverview Notifications API
 * @module services/api/notifications
 *
 * @description
 * - `list`         — fetch the user's notifications, newest first
 * - `markAllRead`  — clear the unread state for every row (called on opening the tab)
 * - `markRead`     — clear a single row
 *
 * @server
 * - GET  /api/notifications
 * - POST /api/notifications/read-all
 * - POST /api/notifications/{id}/read
 */
import { request } from './client';
import type { Notification } from '@/types';

export const notificationsApi = {
  list: () => request<Notification[]>('/api/notifications'),
  markAllRead: () => request<void>('/api/notifications/read-all', { method: 'POST' }),
  markRead: (id: string) => request<void>(`/api/notifications/${id}/read`, { method: 'POST' }),
};
