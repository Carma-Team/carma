/**
 * Gamification Engine — Level Progression & Point Multipliers
 *
 * Pure math module with no external dependencies.
 * Level numbers are prestige labels: 1–5 are regular tiers,
 * 10 is the "Model Driver" max tier (6–9 intentionally skipped by design).
 */

export interface GamificationLevel {
  level: number;
  minPoints: number;
  maxPoints: number;
  multiplier: number;
  label: string;
  unlocksFeature?: string;
}

export const GAMIFICATION_LEVELS: readonly GamificationLevel[] = [
  { level: 1,  minPoints: 0,     maxPoints: 999,      multiplier: 1.00, label: 'Beginner' },
  { level: 2,  minPoints: 1000,  maxPoints: 2499,     multiplier: 1.05, label: 'Learner' },
  { level: 3,  minPoints: 2500,  maxPoints: 4999,     multiplier: 1.10, label: 'Careful',     unlocksFeature: 'Tier 1 Rewards' },
  { level: 4,  minPoints: 5000,  maxPoints: 7999,     multiplier: 1.15, label: 'Reliable' },
  { level: 5,  minPoints: 8000,  maxPoints: 11999,    multiplier: 1.20, label: 'Experienced', unlocksFeature: 'VIP Marketplace' },
  { level: 10, minPoints: 12000, maxPoints: Infinity,  multiplier: 1.50, label: 'Model Driver' },
];

/**
 * Returns the GamificationLevel tier for a given points total.
 * Negative input is clamped to 0.
 */
export function calculateLevel(points: number): GamificationLevel {
  const safe = Math.max(0, points);
  for (let i = GAMIFICATION_LEVELS.length - 1; i >= 0; i--) {
    if (safe >= GAMIFICATION_LEVELS[i].minPoints) {
      return GAMIFICATION_LEVELS[i];
    }
  }
  return GAMIFICATION_LEVELS[0];
}

/**
 * Returns progress within the current level as a percentage [0, 100].
 * Returns 100 at the max level (Model Driver / Level 10).
 * Negative input is clamped to 0.
 */
export function getProgressPercentage(points: number): number {
  const safe = Math.max(0, points);
  const level = calculateLevel(safe);
  if (level.maxPoints === Infinity) return 100;
  const range = level.maxPoints - level.minPoints;
  const progress = safe - level.minPoints;
  return Math.min(100, Math.max(0, Math.round((progress / range) * 100)));
}

export interface LevelUpEvent {
  from: number;
  to: number;
  newMultiplier: number;
  unlocksFeature?: string;
}

/**
 * Compares two point totals and returns a LevelUpEvent if a tier boundary
 * was crossed, or null if the level is unchanged.
 */
export function detectLevelUp(previousPoints: number, newPoints: number): LevelUpEvent | null {
  const prevLevel = calculateLevel(previousPoints);
  const newLevel = calculateLevel(newPoints);
  if (newLevel.level === prevLevel.level) return null;
  return {
    from: prevLevel.level,
    to: newLevel.level,
    newMultiplier: newLevel.multiplier,
    unlocksFeature: newLevel.unlocksFeature,
  };
}
