// ─── Enums ────────────────────────────────────────────────────────────────────
// Server serializes enums as lowercase strings (see UserOut field serializers)
export type UserRole = 'driver' | 'business' | 'admin';
export type Language = 'he' | 'en';
// Friendship between the viewer and another user. `pending` covers a request in
// either direction — one they sent, or one they were sent.
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
  pointsCapped?: boolean;           // v2.1 — an anti-grind cap (daily or rolling-month) reduced this trip's
                                    // award. Save response only. Nothing renders it yet — see CAR-98.
  userLevel?: number;               // driver's level after this trip, as the server resolved it incl. the
                                    // driver-score cap (#37). Save response only — absent on list/detail reads.
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
  // `stock` is the total the business allocated; `available` is what is left of
  // it right now, derived server-side from the vouchers issued against it. null
  // means no cap was set — read it as plenty, never as zero.
  stock: number | null;
  available: number | null;
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

// Matches server's InviteLinkOut / RedeemInviteOut.
export interface InviteLink {
  code: string;
  url: string;
}

export interface RedeemedInvite {
  inviter: { id: string; name?: string | null; city?: string | null; level: number };
  status: FollowStatus;
}

// Matches server's ContactMatchOut — one address-book entry that turned out to
// be a CARMA driver. `phoneHash` identifies which contact matched.
export interface ContactMatch {
  phoneHash: string;
  id: string;
  name?: string | null;
  city?: string | null;
  friendStatus: FollowStatus;
}

// Matches server's FriendRequestOut. `id` is the request id — what accept and
// reject address, not the sender's user id.
export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromUserName?: string | null;
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
  // Days in a row of good driving, and the driver's own record. Days, not trips,
  // and worth no points — the count is the whole reward. The server sends these
  // today; no screen renders them yet (CAR-139).
  currentStreak: number;
  bestStreak: number;
  recentScores: { date: string; score: number }[];
  eventCounts: {
    hardBrakes: number;
    aggressiveAccels: number;
    sharpTurns: number;
    touchEpochs: number;
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────
// Matches server's NotificationOut (server/app/schemas/notification.py).
// The server sends `type` + `payload`, never rendered text, so the strings are
// resolved here through i18n and old rows follow a language switch.
interface NotificationBase {
  id: string;
  readAt: string | null;
  createdAt: string;
}

// Adding a kind means adding a member here — the union then forces every
// consumer to handle it.
export interface LevelUpNotification extends NotificationBase {
  type: 'level_up';
  payload: { level: number; previousLevel: number };
}

/** Demotion (#37). Carries no levels on purpose — the copy says the level was
 *  updated without naming the old or new one. */
export interface LevelDownNotification extends NotificationBase {
  type: 'level_down';
  payload: Record<string, never>;
}

/** Sent to whoever asked, once the other side accepts. `userId` is the accepter. */
export interface FriendAcceptedNotification extends NotificationBase {
  type: 'friend_accepted';
  payload: { userId: string; userName: string | null };
}

/** Sent to the recipient of a friend request. `userId` is whoever asked. */
export interface FriendRequestedNotification extends NotificationBase {
  type: 'friend_requested';
  payload: { userId: string; userName: string | null };
}

export type Notification =
  | LevelUpNotification
  | LevelDownNotification
  | FriendAcceptedNotification
  | FriendRequestedNotification;
export type NotificationType = Notification['type'];

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

// ─── Level ────────────────────────────────────────────────────────────────────
// Matches server's LevelOut (server/app/routers/levels.py), which serves the
// single ladder in app/services/levels.py. The client holds no ladder of its
// own — see constants.ts for the first-paint fallback.
export interface LevelConfig {
  level: number;
  name: string;
  nameEn: string;
  minPoints: number;
  maxPoints: number;
  /** What a trip's points are multiplied by at this level. Display only —
   *  the server has already applied it to the points it returns. */
  bonusMultiplier: number;
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
