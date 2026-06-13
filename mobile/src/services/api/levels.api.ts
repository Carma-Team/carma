/**
 * @fileoverview Levels configuration API
 * @module services/api/levels
 *
 * @description
 * - `list` — fetch all level configurations (names, point thresholds, color, icon, perks)
 *
 * @server
 * - GET /api/levels — returns the levels table from db.json
 */
import { request } from './client';
import type { LevelConfig } from '@/types';

export const levelsApi = {
  list: () => request<{ levels: LevelConfig[] }>('/api/levels'),
};
