// ─── Enums ────────────────────────────────────────────────────────────────────
// Server serializes enums as lowercase strings (see UserOut field serializers)
export type UserRole = 'driver' | 'business' | 'admin';
export type Language = 'he' | 'en';
export type FollowStatus = 'none' | 'pending' | 'accepted' | 'blocked';

// ─── User ─────────────────────────────────────────────────────────────────────
// Matches server's UserOut camelCase wire format
export interface AppUser {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  role: UserRole;
  language: Language;
  avatarUrl?: string;
  age?: number;
  city?: string;
  country?: string;
  licenseYear?: number;
  points: number;
  totalPoints: number;
  totalDistance: number;
  level: number;
  isPrivate: boolean;
  driveModeEnabled: boolean;
  bluetoothDeviceId?: string;
  bluetoothDeviceName?: string;
  businessId?: string;
  businessCategory?: string;
  createdAt?: string;
  rank?: string;
  unreadNotifications?: number;
  lastClearedHistory?: string;
}

// ─── Trip ─────────────────────────────────────────────────────────────────────
// Matches server's TripOut camelCase wire format
export interface Trip {
  id: string;
  userId: string;
  startTime: string;
  endTime?: string;
  distanceKm: number;
  durationSeconds: number;
  avgScore: number;
  points: number;
  hardBrakes: number;
  aggressiveAccels: number;
  sharpTurns: number;
  swerves?: number;                  // EVT_SWERVE — spec §א Table 1
  touchEpochs: number;              // v1.7
  screenInteractionSeconds: number; // v1.7
  riskMultiplier: number;
  pointsCapped?: boolean;           // v2.1 — daily anti-grind caps reduced this trip's award (save response only)
  startLocation?: string;
  endLocation?: string;
  aiInsight?: string;
  status: string;
  // Route map data — only returned by GET /api/trips/:id (not the list endpoint)
  routeWaypoints?: Array<{ lat: number; lng: number; ts: number; speedKmh: number }>;
  // Local-only aliases (used by TripCard/TripDetailScreen for locally-created trips)
  score?: number;
  eventsArray?: any[];
}

// ─── Reward ───────────────────────────────────────────────────────────────────
// Matches server's RewardOut camelCase wire format
export interface Reward {
  id: string;
  businessId: string;
  business: string;        // canonical / English business name
  businessHe?: string;     // Hebrew override; falls back to `business`
  titleHe: string;
  titleEn?: string;
  descriptionHe: string;
  descriptionEn?: string;
  category: string;
  costPoints: number;
  imageIcon: string;
  isActive: boolean;
  stock: number;
  expiresAt?: string;
}

// ─── Voucher ──────────────────────────────────────────────────────────────────
// Matches server's VoucherOut camelCase wire format
export interface Voucher {
  id: string;
  userId: string;
  rewardId: string;
  code: string;
  qrData: string;
  status: 'pending' | 'used' | 'expired' | 'cancelled';
  isUsed: boolean;
  expiresAt: string;
  redeemedAt?: string;
  createdAt: string;
  reward: Reward;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
// Matches server's LeaderboardOut camelCase wire format
export type LeaderboardType = 'friends' | 'city' | 'national';

export interface LeaderboardUserSummary {
  id: string;
  name?: string;
  city?: string;
  level: number;
  avatarUrl?: string;
  isPrivate?: boolean;
}

export interface LeaderboardEntry {
  id: string;
  userId: string;
  rank: number;
  score: number;
  user: LeaderboardUserSummary;
  followStatus?: FollowStatus;
}

export interface LeaderboardOut {
  entries: LeaderboardEntry[];
  currentUserId: string;
  myRank?: number | null;
}

export interface FollowRequest {
  followerId: string;
  followerName?: string;
  followerLevel: number;
  followerCity?: string;
  requestedAt: string;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromUserName: string;
  fromUserLevel: number;
  fromUserCity?: string | null;
  createdAt: string;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
// Matches server's StatsOut camelCase wire format
export interface DrivingStats {
  totalTrips: number;
  totalDistance: number;
  totalPoints: number;
  averageScore: number;
  safeTripsCount: number;
  totalDurationSeconds: number;
  recentScores: { date: string; score: number }[];
  eventCounts: {
    hardBrakes: number;
    aggressiveAccels: number;
    sharpTurns: number;
    touchEpochs: number;
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────
export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'reward' | 'trip';
  timestamp: string;
}

// ─── Trip Validation (local SDK) ─────────────────────────────────────────────
// String literals mirror ValidationState / TransportMode enums in driving-sdk/types.ts
// to avoid a circular import between @/types and the SDK layer.
export interface TripValidationResult {
  isValid: boolean;
  state: 'IDLE' | 'PRE_TRIP' | 'SCORING' | 'ENDED';
  transportMode: 'CAR' | 'TRAIN' | 'UNKNOWN';
  fraudConfidence: number;           // 0–1; Phase 2 populates this
  continuousAboveThresholdMs: number; // Rule 1 counter
  continuousBelowThresholdMs: number; // Rule 2 counter
  invalidReason?: string;            // human-readable, sent to fraud.api
}

// ─── Scoring (local SDK) ──────────────────────────────────────────────────────
export interface ScoringResult {
  score: number;
  points: number;
  riskMultiplier: number;
  penalties: number;
  distanceFactor: number;
}

export interface ScoringInput {
  hardBrakes: number;
  aggressiveAccels: number;
  sharpTurns: number;
  swerves?: number;                 // EVT_SWERVE — spec §א Table 1 (disabled)
  touchEpochs: number;              // v1.7 — glass-tap proxy count
  screenInteractionSeconds: number; // v1.7 — IMU-confirmed hand-held seconds
  durationSeconds: number;
  distanceKm: number;
  startTime: Date;
}

// ─── Level ────────────────────────────────────────────────────────────────────
export interface LevelConfig {
  level: number;
  name: string;
  nameEn: string;
  minPoints: number;
  maxPoints: number;
  color: string;
  icon: string;
  perks: string[];
}

// ─── UI ───────────────────────────────────────────────────────────────────────
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
}
