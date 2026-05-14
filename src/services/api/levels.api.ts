/**
 * @fileoverview API לטעינת הגדרות רמות
 * @module services/api/levels
 *
 * @description
 * - `list` — שליפת כל הגדרות הרמות (שמות, סף נקודות, צבע, אייקון, הטבות)
 *
 * @server
 * - GET /api/levels — מחזיר את טבלת ה-levels מ-db.json
 */
import { request } from './client';
import type { LevelConfig } from '@/types';

export const levelsApi = {
  list: () => request<{ levels: LevelConfig[] }>('/api/levels'),
};
