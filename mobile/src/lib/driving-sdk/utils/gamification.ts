/**
 * Gamification Engine — Level Progression & Point Multipliers
 *
 * Pure math module with no external dependencies.
 * Static 10-level map — do NOT derive bounds via interpolation.
 * maxPoints is computed automatically as next level's minPoints - 1.
 */

export interface GamificationLevel {
  level: number;
  minPoints: number;
  maxPoints: number;
  multiplier: number;
  label: string;
}

const LEVEL_DEFINITIONS = [
  { level: 1,  label: 'Newbie / Beginner', minPoints: 0,     multiplier: 1.00 },
  { level: 2,  label: 'Novice Driver',     minPoints: 1000,  multiplier: 1.05 },
  { level: 3,  label: 'Safe Driver',       minPoints: 2500,  multiplier: 1.10 },
  { level: 4,  label: 'Consistent Driver', minPoints: 4500,  multiplier: 1.15 },
  { level: 5,  label: 'Pro Driver',        minPoints: 6500,  multiplier: 1.20 },
  { level: 6,  label: 'Expert Driver',     minPoints: 8500,  multiplier: 1.25 },
  { level: 7,  label: 'Master Driver',     minPoints: 10500, multiplier: 1.30 },
  { level: 8,  label: 'Elite Driver',      minPoints: 13000, multiplier: 1.35 },
  { level: 9,  label: 'Champion Driver',   minPoints: 16000, multiplier: 1.40 },
  { level: 10, label: 'Model Driver',      minPoints: 20000, multiplier: 1.50 },
] as const;

export const GAMIFICATION_LEVELS: readonly GamificationLevel[] = LEVEL_DEFINITIONS.map(
  (def, i) => ({
    ...def,
    maxPoints: i < LEVEL_DEFINITIONS.length - 1
      ? LEVEL_DEFINITIONS[i + 1].minPoints - 1
      : Infinity,
  })
);

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
 * Returns 100 at Level 10 (Model Driver — no ceiling).
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
}

/**
 * Returns a LevelUpEvent if a tier boundary was crossed between two point
 * totals, or null if both totals fall within the same tier.
 */
export function detectLevelUp(previousPoints: number, newPoints: number): LevelUpEvent | null {
  const prevLevel = calculateLevel(previousPoints);
  const newLevel = calculateLevel(newPoints);
  if (newLevel.level === prevLevel.level) return null;
  return {
    from: prevLevel.level,
    to: newLevel.level,
    newMultiplier: newLevel.multiplier,
  };
}
