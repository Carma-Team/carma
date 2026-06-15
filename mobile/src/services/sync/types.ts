// ─── Telemetry Digest ─────────────────────────────────────────────────────────
// Raw sensor snapshot sent alongside every ValidTripPayload for server-side audit.
// avgScore and points are intentionally absent — the FastAPI server is the sole
// scoring oracle (RFC-001 v1.5). timestamp enables server-side replay detection.
// phoneSeconds REMOVED in v1.7 — replaced by touchEpochs + screenInteractionSeconds.
// All fields are plain scalars so the digest is deterministically JSON-serialisable.

export interface TelemetryDigest {
  distanceKm:               number;  // km, 3 decimal places
  durationSeconds:          number;
  hardBrakes:               number;
  aggressiveAccels:         number;
  sharpTurns:               number;
  swerves?:                 number;  // EVT_SWERVE — spec §א Table 1 (disabled)
  touchEpochs:              number;  // v1.7 — glass-tap proxy count + foreground interactions
  screenInteractionSeconds: number;  // v1.7 — IMU-confirmed hand-held seconds
  riskMultiplier:           number;  // time-of-day multiplier (client-derived, server recomputes)
  startTime:                string;  // ISO 8601 UTC
  endTime:                  string;  // ISO 8601 UTC
  timestamp:                number;  // ms Unix epoch — Date.now() at signing time (replay guard)
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
  swerves?: number;                 // EVT_SWERVE — spec §א Table 1 (disabled)
  touchEpochs: number;              // v1.7 — replaces phoneSeconds
  screenInteractionSeconds: number; // v1.7 — replaces phoneSeconds
  riskMultiplier: number;
  penalties: number;
  // ─── RFC-001: Hybrid Validation fields (optional — backward-compatible) ───
  telemetryDigest?:   TelemetryDigest;
  payloadSignature?:  string;
  // GPS track recorded during the trip — stored server-side for the route map view
  routeWaypoints?:    Array<{ lat: number; lng: number; ts: number; speedKmh: number }>;
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
