import type { LevelConfig } from '@/navigation/types'

export const LEVELS: LevelConfig[] = [
  { level: 1,  name: 'מתחיל',       nameEn: 'Beginner',     minPoints: 0,     maxPoints: 200,      color: '#94a3b8', icon: '🌱', perks: [] },
  { level: 2,  name: 'מתרגל',       nameEn: 'Learner',      minPoints: 200,   maxPoints: 500,      color: '#22c55e', icon: '🚗', perks: ['גישה לטבלת המובילים'] },
  { level: 3,  name: 'זהיר',        nameEn: 'Careful',      minPoints: 500,   maxPoints: 1000,     color: '#16a34a', icon: '⭐', perks: ['הנחות בסיסיות בשוק'] },
  { level: 4,  name: 'אמין',        nameEn: 'Reliable',     minPoints: 1000,  maxPoints: 1800,     color: '#0d9488', icon: '🛡️', perks: ['פרסים בלעדיים'] },
  { level: 5,  name: 'מנוסה',       nameEn: 'Experienced',  minPoints: 1800,  maxPoints: 3000,     color: '#3b82f6', icon: '🏅', perks: ['מכפיל נקודות x1.2'] },
  { level: 6,  name: 'מקצועי',      nameEn: 'Professional', minPoints: 3000,  maxPoints: 4500,     color: '#6366f1', icon: '💎', perks: ['מכפיל נקודות x1.3', 'גישה VIP לפרסים'] },
  { level: 7,  name: 'מצטיין',      nameEn: 'Excellent',    minPoints: 4500,  maxPoints: 6500,     color: '#8b5cf6', icon: '🌟', perks: ['מכפיל x1.4', 'בונוס חודשי'] },
  { level: 8,  name: 'אלוף',        nameEn: 'Champion',     minPoints: 6500,  maxPoints: 9000,     color: '#f59e0b', icon: '🏆', perks: ['מכפיל x1.5', 'תג אלוף'] },
  { level: 9,  name: 'גנרל הכביש', nameEn: 'Road General', minPoints: 9000,  maxPoints: 12000,    color: '#ef4444', icon: '⚡', perks: ['מכפיל x1.7', 'VIP לכל הפרסים'] },
  { level: 10, name: 'נהג מדגם',    nameEn: 'Model Driver', minPoints: 12000, maxPoints: Infinity, color: '#f97316', icon: '👑', perks: ['מכפיל x2.0', 'תג הנהג המדגם', 'גישה לכל'] },
]

export function getLevelConfig(level: number): LevelConfig {
  return LEVELS[Math.min(level - 1, LEVELS.length - 1)]
}

export function getLevelByPoints(points: number): number {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (points >= LEVELS[i].minPoints) return LEVELS[i].level
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

export const RISK_HOURS = {
  WEEKEND_NIGHT: { days: [4, 5], startHour: 23, endHour: 4, multiplier: 2.0 },
  WEEKDAY_NIGHT: { days: [0, 1, 2, 3, 6], startHour: 23, endHour: 4, multiplier: 1.5 },
}

export const REWARD_CATEGORIES = [
  { key: 'fuel',          labelHe: 'דלק',          labelEn: 'Fuel',          emoji: '⛽' },
  { key: 'food',          labelHe: 'אוכל ושתייה',  labelEn: 'Food & Drink',  emoji: '🍕' },
  { key: 'eco',           labelHe: 'תחבורה ירוקה', labelEn: 'Green Transit', emoji: '🌿' },
  { key: 'entertainment', labelHe: 'בידור',         labelEn: 'Entertainment', emoji: '🎬' },
  { key: 'shopping',      labelHe: 'קניות',         labelEn: 'Shopping',      emoji: '🛒' },
]

export const EVENT_PROBABILITIES = {
  HARD_BRAKE:       0.15,
  AGGRESSIVE_ACCEL: 0.12,
  SHARP_TURN:       0.10,
  PHONE_TOUCH:      0.08,
}

export const TRIP_SIMULATION_INTERVAL_MS = 3000
export const TRIP_SPEED_KM_PER_MIN = 0.5

/**
 * ─── Design Tokens (Centralized Theme) ───────────────────────────────────────
 * שינוי כאן ישפיע על כל האפליקציה: צבעים, ריווחים וטיפוגרפיה.
 */
export const COLORS = {
  dark:       '#0a0f1e', // רקע ראשי
  card:       '#111827', // רקע כרטיסים/אלמנטים
  border:     '#1f2937', // גבולות
  brand:      '#6366f1', // צבע מותג ראשי
  brandLight: '#818cf8', // צבע מותג בהיר (לטקסט דגש)
  text:       '#ffffff', // טקסט ראשי
  textMuted:  '#94a3b8', // טקסט משני/עמום
  success:    '#22c55e',
  warning:    '#f59e0b',
  danger:     '#ef4444',
}

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
}

export const TYPOGRAPHY = {
  h1: { fontSize: 32, fontWeight: '900' as const, color: COLORS.text },
  h2: { fontSize: 24, fontWeight: '800' as const, color: COLORS.text },
  h3: { fontSize: 18, fontWeight: '700' as const, color: COLORS.text },
  body: { fontSize: 16, color: COLORS.text },
  caption: { fontSize: 13, color: COLORS.textMuted },
  label: { fontSize: 14, fontWeight: '600' as const, color: COLORS.textMuted },
}

export const COMMON_STYLES = {
  screen: {
    flex: 1,
    backgroundColor: COLORS.dark,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  // תבניות פריסה נפוצות לחיסכון בקוד מקומי
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  rowBetween: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  center: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center' as const,
    padding: 24,
  },
  section: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.sm,
  },
  // סגנון אחיד לכרטיסי סטטיסטיקה (בשימוש ברוב המסכים)
  statGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    minWidth: '30%',
    alignItems: 'center' as const,
    padding: SPACING.sm,
  },
  statEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  statValue: {
    ...TYPOGRAPHY.label,
    color: '#fff',
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center' as const,
  },
  // סגנון למצבי "אין נתונים"
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center' as const,
  },
  // טאבים (Leaderboard, Marketplace, Profile)
  tabsContainer: {
    flexDirection: 'row' as const,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center' as const,
  },
  tabActive: {
    backgroundColor: COLORS.brand,
  },
  tabText: {
    ...TYPOGRAPHY.label,
    fontSize: 13,
  },
  tabTextActive: {
    color: '#fff',
  }
}
