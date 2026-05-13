// Navigation param-list types
export type RootStackParamList = {
  Login:    undefined
  Register: undefined
  Main:     undefined
  TripDetail: { tripId: string }
}

export type MainTabParamList = {
  Dashboard:   undefined
  Trip:        undefined
  Roadmap:     undefined
  Marketplace: undefined
  Leaderboard: undefined
  Profile:     undefined
}

// ─── Database Entities (Mapping to 5.3.1) ────────────────────────────────────

export type UserRole = 'driver' | 'business' | 'admin';

/** 5.3.1.1 User */
export interface AppUser {
  id: string
  name: string
  phone?: string
  role: UserRole
  businessId?: string // מזהה העסק עבור משתמש מסוג business
  points: number
  totalPoints?: number
  totalDistance?: number
  level: number
  license_img_url?: string
  language: 'he' | 'en'
  rank?: string
  email?: string // For login context
  city?: string
  country?: string
  created_at?: string
  last_logged?: string
  last_cleared_history?: string // Timestamp for UI filtering
  driveModeEnabled?: boolean
  bluetoothDeviceId?: string
  bluetoothDeviceName?: string
}

/** 5.3.1.2 Trip */
export interface Trip {
  id: string
  user_id: string
  start_time: string
  end_time?: string
  avg_score: number
  distance: number
  events_array: any[]
  // camelCase aliases returned by the server (normalized in trips.api.ts)
  distanceKm?: number
  startTime?: string
  endTime?: string
  avgScore?: number
  userId?: string
  events?: any[]
  // extra display fields
  score?: number
  points?: number
  durationSeconds?: number
  hardBrakes?: number
  aggressiveAccels?: number
  sharpTurns?: number
  phoneSeconds?: number
}

/** 5.3.1.3 Reward */
export interface Reward {
  id: string
  business_id: string
  description: string // Hebrew/Main title
  titleEn?: string    // For localization
  title?: string      // Fallback
  cost_points: number
  expiry_date?: string
  imageEmoji?: string // UI helper
  category?: string   // UI helper
  business_name?: string
  business?: string   // Fallback
  stock?: number
}

/** 5.3.1.5 Redemption (Voucher) */
export interface Voucher {
  id: string
  user_id: string
  reward_id: string
  qr_code: string
  code?: string // Fallback
  status: 'active' | 'used' | 'expired'
  created_at: string
  expired_at: string
  expiresAt?: string // Fallback
  reward?: Partial<Reward>
  isUsed?: boolean // Fallback UI
}

// ─── UI & Others ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string
  user_id: string
  rank: number
  score: number
  user: {
    name: string
    city: string
    level?: number
  }
}

export interface DrivingStats {
  totalPoints: number
  totalDistance: number
  tripsCount: number
  level: number
  rank: string
}

export interface Notification {
  id: string
  title: string
  body: string
  type: 'info' | 'reward' | 'trip'
  timestamp: string
}

export interface ScoringResult {
  score: number
  pointsEarned: number
  rankUp?: boolean
}
