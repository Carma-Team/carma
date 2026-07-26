import type { LevelConfig } from '@/types'

// First-paint cache only — `setLevels` replaces this the moment AppContext
// loads GET /api/levels. It is NOT a source of truth: the ladder is defined
// once, in server/app/services/levels.py (#61).
//
// Kept byte-for-byte in step with that module so a cold start does not flash
// different numbers. If the two ever disagree, the server is right.
const DEFAULT_LEVELS: LevelConfig[] = [
  { level: 1,  name: 'מתחיל',      nameEn: 'Beginner',     minPoints: 0,     maxPoints: 499,    discountPct: 0,  bonusMultiplier: 1.00, color: '#94a3b8', icon: 'leaf-outline',             perks: [] },
  { level: 2,  name: 'זהיר',       nameEn: 'Cautious',     minPoints: 500,   maxPoints: 1499,   discountPct: 0,  bonusMultiplier: 1.02, color: '#22c55e', icon: 'compass-outline',          perks: ['גישה לטבלת המובילים'] },
  { level: 3,  name: 'מרוכז',      nameEn: 'Focused',      minPoints: 1500,  maxPoints: 3499,   discountPct: 5,  bonusMultiplier: 1.04, color: '#16a34a', icon: 'aperture-outline',         perks: ['5% הנחה בחנות הפרסים'] },
  { level: 4,  name: 'מיומן',      nameEn: 'Skilled',      minPoints: 3500,  maxPoints: 6999,   discountPct: 5,  bonusMultiplier: 1.06, color: '#0d9488', icon: 'flash-outline',            perks: ['5% הנחה בחנות הפרסים', 'פרסים בלעדיים'] },
  { level: 5,  name: 'חד',         nameEn: 'Sharp',        minPoints: 7000,  maxPoints: 11999,  discountPct: 10, bonusMultiplier: 1.08, color: '#3b82f6', icon: 'shield-checkmark-outline', perks: ['10% הנחה', 'מכפיל נקודות x1.08'] },
  { level: 6,  name: 'מומחה',      nameEn: 'Expert',       minPoints: 12000, maxPoints: 19999,  discountPct: 10, bonusMultiplier: 1.10, color: '#6366f1', icon: 'flame-outline',            perks: ['10% הנחה', 'גישה VIP לפרסים'] },
  { level: 7,  name: 'אשף',        nameEn: 'Wizard',       minPoints: 20000, maxPoints: 31999,  discountPct: 15, bonusMultiplier: 1.12, color: '#8b5cf6', icon: 'star-outline',             perks: ['15% הנחה', 'מכפיל נקודות x1.12'] },
  { level: 8,  name: 'מאסטר',      nameEn: 'Master',       minPoints: 32000, maxPoints: 49999,  discountPct: 15, bonusMultiplier: 1.15, color: '#f59e0b', icon: 'diamond-outline',          perks: ['15% הנחה', 'תג מאסטר'] },
  { level: 9,  name: 'גנרל הכביש', nameEn: 'Road General', minPoints: 50000, maxPoints: 74999,  discountPct: 20, bonusMultiplier: 1.18, color: '#ef4444', icon: 'trophy-outline',           perks: ['20% הנחה', 'VIP לכל הפרסים'] },
  { level: 10, name: 'אגדה',       nameEn: 'Legend',       minPoints: 75000, maxPoints: 2147483647, discountPct: 25, bonusMultiplier: 1.25, color: '#f97316', icon: 'ribbon-outline',      perks: ['25% הנחה', 'מכפיל נקודות x1.25'] },
]

let _levels: LevelConfig[] = DEFAULT_LEVELS;

/** Called by AppContext after loading /api/levels from the server */
export function setLevels(levels: LevelConfig[]) {
  _levels = levels;
}

export { _levels as LEVELS };

/** True for the last rung, whose band has no real ceiling.
 *  The server sends int32 max rather than Infinity (JSON has no Infinity), so
 *  a `=== Infinity` check silently treats the top level as a bounded band. */
export function isTopLevel(level: number): boolean {
  return level >= _levels[_levels.length - 1].level
}

/** Clamped both ends — a level outside the ladder must not return undefined. */
export function getLevelConfig(level: number): LevelConfig {
  const idx = Math.min(Math.max(level, 1), _levels.length) - 1
  return _levels[idx]
}

export function getLevelByPoints(points: number): number {
  for (let i = _levels.length - 1; i >= 0; i--) {
    if (points >= _levels[i].minPoints) return _levels[i].level
  }
  return 1
}

export function getPointsToNextLevel(currentPoints: number, currentLevel: number): number {
  if (isTopLevel(currentLevel)) return 0
  const config = getLevelConfig(currentLevel)
  return Math.max(0, config.maxPoints - currentPoints)
}

export function getLevelProgress(currentPoints: number, currentLevel: number): number {
  if (isTopLevel(currentLevel)) return 100
  const config = getLevelConfig(currentLevel)
  if (!config) return 100

  const range = config.maxPoints - config.minPoints
  if (range <= 0) return 0

  const progress = currentPoints - config.minPoints
  const percent = Math.round((progress / range) * 100)

  return Math.min(100, Math.max(0, percent))
}

export interface UserLevelData {
  currentLevel: number;
  config: LevelConfig;
  progress: number;
  pointsToNext: number;
  isMaxLevel: boolean;
}

export function getUserLevelData(totalPoints: number): UserLevelData {
  const level = getLevelByPoints(totalPoints);
  const config = getLevelConfig(level);
  const progress = getLevelProgress(totalPoints, level);
  const pointsToNext = getPointsToNextLevel(totalPoints, level);

  return {
    currentLevel: level,
    config,
    progress,
    pointsToNext,
    isMaxLevel: config.maxPoints === Infinity
  };
}

export const RISK_HOURS = {
  WEEKEND_NIGHT: { days: [4, 5], startHour: 23, endHour: 4, multiplier: 2.0 },
  WEEKDAY_NIGHT: { days: [0, 1, 2, 3, 6], startHour: 23, endHour: 4, multiplier: 1.5 },
}

export const REWARD_CATEGORIES = [
  { key: 'fuel',          labelHe: 'דלק',          labelEn: 'Fuel',          icon: 'car-outline' },
  { key: 'food',          labelHe: 'אוכל ושתייה',  labelEn: 'Food & Drink',  icon: 'restaurant-outline' },
  { key: 'eco',           labelHe: 'תחבורה ירוקה', labelEn: 'Green Transit', icon: 'leaf-outline' },
  { key: 'entertainment', labelHe: 'בידור',         labelEn: 'Entertainment', icon: 'film-outline' },
  { key: 'shopping',      labelHe: 'קניות',         labelEn: 'Shopping',      icon: 'cart-outline' },
  { key: 'other',         labelHe: 'אחר',           labelEn: 'Other',         icon: 'cube-outline' },
]

export const EVENT_PROBABILITIES = {
  HARD_BRAKE:       0.15,
  AGGRESSIVE_ACCEL: 0.12,
  SHARP_TURN:       0.10,
  PHONE_TOUCH:      0.08,
}

export const TRIP_SIMULATION_INTERVAL_MS = 3000
export const TRIP_SPEED_KM_PER_MIN = 0.5
