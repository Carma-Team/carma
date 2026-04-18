// ─── User ────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  name: string
  email: string
  phone?: string | null
  city?: string | null
  age?: number | null
  licenseYear?: number | null
  totalPoints: number
  totalDistance: number
  level: number
  avatarUrl?: string | null
  createdAt: string
  // הגדרות מצב רכב
  driveModeEnabled?: boolean
  bluetoothDeviceId?: string | null
  bluetoothDeviceName?: string | null
}

// ─── Trip ────────────────────────────────────────────────────────────────────
export type TripStatus = 'active' | 'completed'

export type TripEventType =
  | 'HARD_BRAKE'
  | 'AGGRESSIVE_ACCEL'
  | 'SHARP_TURN'
  | 'PHONE_TOUCH'

export interface TripEvent {
  id?: string
  tripId?: string
  eventType: TripEventType
  timestamp: string
  severity: number
}

export interface Trip {
  id: string
  userId: string
  startTime: string
  endTime?: string | null
  distanceKm: number
  durationSeconds: number
  score: number
  points: number
  hardBrakes: number
  aggressiveAccels: number
  sharpTurns: number
  phoneSeconds: number
  riskMultiplier: number
  startLocation?: string | null
  endLocation?: string | null
  aiInsight?: string | null
  status: TripStatus
  events?: TripEvent[]
}

// ─── Reward / Voucher ────────────────────────────────────────────────────────
export type RewardCategory = 'fuel' | 'food' | 'eco' | 'entertainment' | 'shopping'

export interface Reward {
  id: string
  title: string
  titleEn?: string | null
  description: string
  descriptionEn?: string | null
  business: string
  category: RewardCategory
  pointsCost: number
  imageEmoji: string
  isActive: boolean
  stock: number
  expiresAt?: string | null
}

export interface Voucher {
  id: string
  userId: string
  rewardId: string
  code: string
  qrData: string
  redeemedAt?: string | null
  expiresAt: string
  isUsed: boolean
  createdAt: string
  reward?: Reward
}

// ─── Achievement ─────────────────────────────────────────────────────────────
export interface Achievement {
  id: string
  key: string
  title: string
  titleEn?: string | null
  description: string
  descriptionEn?: string | null
  emoji: string
  pointsBonus: number
  condition: string
  earnedAt?: string
  earned?: boolean
}

// ─── Notification ────────────────────────────────────────────────────────────
export type NotificationType = 'trip_complete' | 'achievement' | 'reward' | 'system'

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  titleHe: string
  titleEn?: string | null
  bodyHe: string
  bodyEn?: string | null
  isRead: boolean
  data?: string | null
  createdAt: string
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
export type LeaderboardType = 'friends' | 'city' | 'national'
export type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime'

export interface LeaderboardEntry {
  id: string
  userId: string
  type: LeaderboardType
  rank: number
  score: number
  period: LeaderboardPeriod
  user?: {
    id: string
    name: string
    city?: string | null
    level: number
    avatarUrl?: string | null
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────
export interface DrivingStats {
  totalTrips: number
  totalDistance: number
  totalPoints: number
  averageScore: number
  totalDurationSeconds: number
  safeTripsCount: number
  recentScores: { date: string; score: number }[]
  eventCounts: {
    hardBrakes: number
    aggressiveAccels: number
    sharpTurns: number
    phoneSeconds: number
  }
}

// ─── Level ───────────────────────────────────────────────────────────────────
export interface LevelConfig {
  level: number
  name: string
  nameEn: string
  minPoints: number
  maxPoints: number
  color: string
  icon: string
  perks: string[]
}

// ─── App context ─────────────────────────────────────────────────────────────
export type Language = 'he' | 'en'

export interface AppUser extends User {
  unreadNotifications?: number
}

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

// ─── API ─────────────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
export interface ScoringInput {
  hardBrakes: number
  aggressiveAccels: number
  sharpTurns: number
  phoneSeconds: number
  durationSeconds: number
  distanceKm: number
  startTime: Date
}

export interface ScoringResult {
  score: number
  points: number
  riskMultiplier: number
  penalties: number
  distanceFactor: number
}
