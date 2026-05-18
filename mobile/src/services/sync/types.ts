// ─── Valid Trip DTO ───────────────────────────────────────────────────────────
// Canonical payload for POST /api/trips. `localTripId` is generated on the
// client at trip-start and sent as the `Idempotency-Key` header; Sean's server
// should store it in a UNIQUE column so duplicate POSTs are safe to retry.

export interface ValidTripPayload {
  localTripId: string;       // client-generated at startTrip() — stable across retries
  startTime: string;         // ISO
  endTime: string;           // ISO
  distanceKm: number;
  durationSeconds: number;
  avgScore: number;
  points: number;
  hardBrakes: number;
  aggressiveAccels: number;
  sharpTurns: number;
  phoneSeconds: number;
  riskMultiplier: number;
  penalties: number;
}

// ─── Queue Item ───────────────────────────────────────────────────────────────
// Persisted to AsyncStorage under QUEUE_KEY. Tracks retry state per item.

export interface SyncQueueItem {
  id: string;                // = localTripId — used for dedup inside the queue
  payload: ValidTripPayload;
  queuedAt: string;          // ISO — when enqueued (for future TTL / audit)
  attempts: number;          // how many times we tried and failed
  lastAttemptAt: string | null;
}
