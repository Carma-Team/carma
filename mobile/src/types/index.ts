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
  /**
   * Trips the driver deleted one by one. Client-only and, like the cutoff above,
   * a hide rather than a delete — the server has no endpoint for removing a trip
   * (CAR-307), so this list is what stands in until it does. It lives in
   * AsyncStorage, so a reinstall brings the trips back.
   */
  deletedTripIds?: string[];
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
/** Answer to a code request. Says nothing about whether the number is registered. */
export type OtpSent = Schemas['OtpSent'];
export type MessageOut = Schemas['MessageOut'];

// ─── Trip ─────────────────────────────────────────────────────────────────────
// The two members the schema genuinely cannot supply, and the only ones either trip
// shape adds to it. Both fall under an exception the header names: the first is a
// shape OpenAPI flattens, the second has no server existence at all.
type TripClientFields = {
  /**
   * Flattened exception. `TripDetailOut.routeWaypoints` is typed as an opaque
   * `{[key: string]: unknown}[]`, which says nothing about the four keys the map
   * reads. Narrowed here rather than cast at each use.
   * Only `GET /api/trips/:id` returns it; the list endpoint never does.
   */
  routeWaypoints?: { lat: number; lng: number; ts: number; speedKmh: number }[];
  /**
   * Client-only exception. Set on the row we create ourselves when the save never
   * landed, and gone once SyncManager swaps in the server's row. The schema requires
   * avgScore and points, so that row carries zeros — this flag is what tells them
   * apart from a trip the server actually scored zero.
   */
  pendingSync?: boolean;
  /**
   * Client-only exception. Set when the queue gives up on a row it has been carrying
   * for too long (CAR-166). The trip stays on the device and is never sent — nothing
   * here retries it, so it is a terminal state and not a slower `pendingSync`.
   */
  syncFailed?: boolean;
};

export type Trip = Schemas['TripOut'] & TripClientFields;

// Returned by GET /api/trips/:id only, never by the list endpoint. `type` arrives
// lower-cased on the wire — use lib/tripEvents.ts to reach the SDK's enum. `severity`
// is 1.0–3.0 for every type (scoring.md §3.4); it is not the SDK's 0–1 field of the
// same name, and nothing converts between them.
export type TripEvent = Schemas['EventOut'];

// Derived rather than `extends Trip` with a hand-written `events`: the copy declared
// events optional while the contract requires it with a default, and nothing in CI
// compares a hand-written type against the schema it is shadowing (CAR-271).
export type TripDetail = Schemas['TripDetailOut'] & TripClientFields;

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

// ─── Staged calibration recordings ────────────────────────────────────────────
// One drive in the server's index (CAR-213). The row the upload route returns —
// the client reads `sessionId` off it and nothing else, but the alias is what
// keeps a field rename on the server a type error here rather than `undefined`.
export type RawRecording = Schemas['RawRecordingOut'];

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
