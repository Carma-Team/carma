/**
 * Gamification — level presentation.
 *
 * The server owns the ladder (`app/services/levels.py`, served by
 * `GET /api/levels`). Nothing here computes a level or applies a multiplier —
 * these are lookups into what the server sent, for display only.
 *
 * Points arrive already multiplied. Never scale them again (#29).
 */

import { LEVELS, getLevelConfig, isTopLevel } from './constants';
import type { LevelConfig } from '@/types';

export interface GamificationLevel {
  level: number;
  minPoints: number;
  maxPoints: number;
  label: string;
}

function toGamificationLevel(config: LevelConfig): GamificationLevel {
  return {
    level: config.level,
    minPoints: config.minPoints,
    maxPoints: config.maxPoints,
    label: config.nameEn,
  };
}

/**
 * Presentation data for a level number that came from the server (`user.level`).
 * Out-of-range input is clamped rather than throwing — `getLevelConfig` handles it.
 */
export function levelDisplay(level: number): GamificationLevel {
  return toGamificationLevel(getLevelConfig(level));
}

/**
 * Progress through the current level, as a percentage [0, 100].
 *
 * Takes the level from the server rather than re-deriving it from points, so a
 * demoted driver (#37) sees progress within the level they are actually on.
 * Returns 100 on the top level, which has no ceiling.
 */
export function getProgressPercentage(points: number, level: number): number {
  if (isTopLevel(level)) return 100;
  const config = getLevelConfig(level);
  const safe = Math.max(0, points);
  const range = config.maxPoints - config.minPoints;
  if (range <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((safe - config.minPoints) / range) * 100)));
}

export interface LevelUpEvent {
  from: number;
  to: number;
}

/**
 * A level change between two server-reported levels, or null if unchanged.
 *
 * Direction is not assumed: levels can fall as well as rise now that the server
 * caps them by driver score (#37), and the caller decides how to present each.
 */
export function detectLevelChange(previousLevel: number, newLevel: number): LevelUpEvent | null {
  if (previousLevel === newLevel) return null;
  return { from: previousLevel, to: newLevel };
}

/** Every level, in order — for the roadmap screen. */
export function allLevels(): GamificationLevel[] {
  return LEVELS.map(toGamificationLevel);
}
