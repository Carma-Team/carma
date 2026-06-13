/**
 * @fileoverview Notifications API
 * @module services/api/notifications
 *
 * @description
 * - `list` — fetch the user's notification list
 *
 * @server
 * - GET /api/notifications — USE_REAL_SERVER=false → mock (empty list from local server); true → real server
 */
import { request } from './client';
import type { Notification } from '@/types';

export const notificationsApi = {
  list: () => request<Notification[]>('/api/notifications'),
};
