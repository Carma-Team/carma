import type { LevelConfig } from '@/types'

// Fallback — replaced by server data once AppContext loads /api/levels
const DEFAULT_LEVELS: LevelConfig[] = [
  { level: 1,  name: 'מתחיל',       nameEn: 'Beginner',     minPoints: 0,     maxPoints: 199,   color: '#94a3b8', icon: 'leaf-outline',             perks: [] },
  { level: 2,  name: 'מתרגל',       nameEn: 'Learner',      minPoints: 200,   maxPoints: 499,   color: '#22c55e', icon: 'compass-outline',          perks: ['גישה לטבלת המובילים'] },
  { level: 3,  name: 'זהיר',        nameEn: 'Careful',      minPoints: 500,   maxPoints: 999,   color: '#16a34a', icon: 'aperture-outline',         perks: ['הנחות בסיסיות בשוק'] },
  { level: 4,  name: 'אמין',        nameEn: 'Reliable',     minPoints: 1000,  maxPoints: 1799,  color: '#0d9488', icon: 'flash-outline',            perks: ['פרסים בלעדיים'] },
  { level: 5,  name: 'מנוסה',       nameEn: 'Experienced',  minPoints: 1800,  maxPoints: 2999,  color: '#3b82f6', icon: 'shield-checkmark-outline', perks: ['מכפיל נקודות x1.2'] },
  { level: 6,  name: 'מקצועי',      nameEn: 'Professional', minPoints: 3000,  maxPoints: 4499,  color: '#6366f1', icon: 'flame-outline',            perks: ['מכפיל נקודות x1.3', 'גישה VIP לפרסים'] },
  { level: 7,  name: 'מצטיין',      nameEn: 'Excellent',    minPoints: 4500,  maxPoints: 6499,  color: '#8b5cf6', icon: 'star-outline',             perks: ['מכפיל x1.4', 'בונוס חודשי'] },
  { level: 8,  name: 'אלוף',        nameEn: 'Champion',     minPoints: 6500,  maxPoints: 8999,  color: '#f59e0b', icon: 'diamond-outline',          perks: ['מכפיל x1.5', 'תג אלוף'] },
  { level: 9,  name: 'גנרל הכביש', nameEn: 'Road General', minPoints: 9000,  maxPoints: 11999, color: '#ef4444', icon: 'trophy-outline',           perks: ['מכפיל x1.7', 'VIP לכל הפרסים'] },
  { level: 10, name: 'נהג מדגם',    nameEn: 'Model Driver', minPoints: 12000, maxPoints: Infinity, color: '#f97316', icon: 'ribbon-outline',        perks: ['מכפיל x2.0', 'תג הנהג המדגם', 'גישה לכל'] },
]

let _levels: LevelConfig[] = DEFAULT_LEVELS;

/** Called by AppContext after loading /api/levels from the server */
export function setLevels(levels: LevelConfig[]) {
  _levels = levels;
}

export { _levels as LEVELS };

export function getLevelConfig(level: number): LevelConfig {
  return _levels[Math.min(level - 1, _levels.length - 1)]
}

export function getLevelByPoints(points: number): number {
  for (let i = _levels.length - 1; i >= 0; i--) {
    if (points >= _levels[i].minPoints) return _levels[i].level
  }
  return 1
}

export function getPointsToNextLevel(currentPoints: number, currentLevel: number): number {
  const config = getLevelConfig(currentLevel)
  if (config.maxPoints === Infinity) return 0
  return Math.max(0, config.maxPoints - currentPoints)
}

export function getLevelProgress(currentPoints: number, currentLevel: number): number {
  const config = getLevelConfig(currentLevel)
  if (!config || config.maxPoints === Infinity) return 100

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
