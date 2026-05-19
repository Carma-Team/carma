// ─── Telemetry Digest ─────────────────────────────────────────────────────────
// Clean snapshot of trip metrics sent alongside every ValidTripPayload.
// The server stores this for audit and uses it to verify the client score (RFC-001).
// All fields are plain scalars so the digest is deterministically JSON-serialisable.

export interface TelemetryDigest {
  avgScore:         number;  // client-computed score 0–100 (1 decimal)
  points:           number;  // raw points before level multiplier
  distanceKm:       number;  // km, 3 decimal places
  durationSeconds:  number;
  hardBrakes:       number;
  aggressiveAccels: number;
  sharpTurns:       number;
  phoneSeconds:     number;  // raw (unweighted) phone usage seconds
  riskMultiplier:   number;  // time-of-day multiplier applied to points
  startTime:        string;  // ISO 8601 UTC
  endTime:          string;  // ISO 8601 UTC
}

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
  // ─── RFC-001: Hybrid Validation fields (optional — backward-compatible) ───
  // Server stores telemetryDigest for audit and uses it to detect score spoofing.
  // payloadSignature is an HMAC-SHA256 of the digest (FNV-1a placeholder in Phase 1).
  telemetryDigest?:   TelemetryDigest;
  payloadSignature?:  string;
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
