// The server's OpenAPI schema is the contract of record. Everything the server
// sends is derived from `generated.ts` — run `npm run gen:api` after a server
// schema change and `tsc` points at every consequence.
//
// Only two things are still written by hand: client-only fields the server has
// no notion of, and the handful of shapes the schema flattens to `string` or an
// opaque object where the wire format is really narrower.
import type { components } from '@/services/api/generated';

type Schemas = components['schemas'];

// ─── Enums ────────────────────────────────────────────────────────────────────
export type UserRole = Schemas['UserRole'];
export type Language = Schemas['Language'];
// Friendship between the viewer and another user. `pending` covers a request in
// either direction — one they sent, or one they were sent.
export type FollowStatus = Schemas['FriendStatusOut']['status'];

// ─── User ─────────────────────────────────────────────────────────────────────
export type AppUser = Schemas['UserOut'] & {
  /** Leaderboard filter default. Client-only — the server has no country field. */
  country?: string;
  /** Local hide-old-trips cutoff. Client-only; nothing is deleted server-side. */
  lastClearedHistory?: string;
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
/** Answer to a code request. Says nothing about whether the number is registered. */
export type OtpSent = Schemas['OtpSent'];
export type MessageOut = Schemas['MessageOut'];

// ─── Trip ─────────────────────────────────────────────────────────────────────
export type Trip = Schemas['TripOut'] & {
  // Route map data — only returned by GET /api/trips/:id (not the list endpoint).
  // The schema types waypoints as an opaque object; this is what the map reads.
  routeWaypoints?: { lat: number; lng: number; ts: number; speedKmh: number }[];
  // Local-only aliases (used by TripCard/TripDetailScreen for locally-created trips)
  score?: number;
  // Client-only. Set on the row we create ourselves when the save never landed, and
  // gone once SyncManager swaps in the server's row. The schema requires avgScore and
  // points, so that row carries zeros — this flag is what tells them apart from a
  // trip the server actually scored zero.
  pendingSync?: boolean;
  eventsArray?: any[];
};

// Returned by GET /api/trips/:id only, never by the list endpoint. `type` arrives
// lower-cased on the wire — use lib/tripEvents.ts to reach the SDK's enum. `severity`
// is 1.0–3.0 for every type (scoring.md §3.4); it is not the SDK's 0–1 field of the
// same name, and nothing converts between them.
export type TripEvent = Schemas['EventOut'];

export interface TripDetail extends Trip {
  events?: TripEvent[];
}

// ─── Reward ───────────────────────────────────────────────────────────────────
// `stock` is the total the business allocated; `available` is what is left of it
// right now, derived server-side from the vouchers issued against it. null means
// no cap was set — read it as plenty, never as zero.
export type Reward = Schemas['RewardOut'];

// ─── Voucher ──────────────────────────────────────────────────────────────────
export interface Voucher extends Omit<Schemas['VoucherOut'], 'status'> {
  // The server lowercases RedemptionStatus on the way out (schemas/reward.py),
  // so the schema can only say `string`. These four are the real values.
  status: 'pending' | 'used' | 'expired' | 'cancelled';
}

// ─── City (CAR-218) ───────────────────────────────────────────────────────────
// A settlement is a reference row with a name per language, never a bare label.
export type City = Schemas['CityOut'];


// ─── Leaderboard ──────────────────────────────────────────────────────────────
export type LeaderboardType = 'friends' | 'city' | 'national';

export type LeaderboardUserSummary = Schemas['LeaderboardUserSummary'];
export type LeaderboardEntry = Schemas['LeaderboardEntry'];
export type LeaderboardOut = Schemas['LeaderboardOut'];

export type InviteLink = Schemas['InviteLinkOut'];
export type RedeemedInvite = Schemas['RedeemInviteOut'];

// One address-book entry that turned out to be a CARMA driver. `phoneHash`
// identifies which contact matched.
export type ContactMatch = Schemas['ContactMatchOut'];

// `id` is the request id — what accept and reject address, not the sender's user id.
export type FriendRequest = Schemas['FriendRequestOut'];

// ─── Stats ────────────────────────────────────────────────────────────────────
export type DrivingStats = Schemas['DrivingStats'];

// ─── Notifications ────────────────────────────────────────────────────────────
// The one place a hand-written type beats the generated one: `payload` varies by
// `type`, and OpenAPI flattens it to an opaque object. The union below keeps each
// payload tied to its type, so adding a kind forces every consumer to handle it.
//
// The server sends `type` + `payload`, never rendered text, so the strings are
// resolved here through i18n and old rows follow a language switch.
type NotificationBase = Omit<Schemas['NotificationOut'], 'type' | 'payload'>;

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
// String literals mirror the ValidationState enum in driving-sdk/types.ts and the
// TransportMode enum in lib/transportMode.ts, to avoid a circular import between
// @/types and the SDK layer.
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
// Serves the single ladder in app/services/levels.py. The client holds no ladder
// of its own — see constants.ts for the first-paint fallback. `bonusMultiplier`
// is display only: the server has already applied it to the points it returns.
export type LevelConfig = Schemas['LevelOut'];

// ─── UI ───────────────────────────────────────────────────────────────────────
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
}
