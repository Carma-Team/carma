/**
 * @file tripPayload.ts
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Builds the payload a finished trip is saved with: the canonical raw-sensor
 * digest, its signature, and the request body the two of them travel in.
 * @description
 * Pure mapping from what the SDK measured to what the server is sent. It lived inside the
 * app's React context, which is where the repository's own instructions point at as the
 * example of how a context grows to 700 lines - the shaping of a payload is neither
 * global state nor a server call, and it is the part of ending a trip that can be read
 * and checked on its own.
 *
 * Nothing here scores anything. `avgScore`, `points` and `penalties` are sent as zeros
 * because the field exists in the contract and the server is the sole scoring oracle;
 * they are placeholders, not values this client computed.
 *
 * Signing failure is not an error here. A trip that reaches the server unsigned is worth
 * more than a trip that was never saved, so the digest and signature are both optional
 * and their absence travels with the payload rather than stopping it.
 */
import { signTelemetryDigest } from '@/lib/telemetrySigning'
import type { TripData } from '@/lib/driving-sdk'
import type { TripState } from '@/context/tripState'
import type { TelemetryDigest, ValidTripPayload } from '@/services/sync/types'

// ─── TelemetryDigest builder ──────────────────────────────────────────────────
// Produces the raw-sensor canonical snapshot defined in RFC-001 v1.7 §3.1.
// avgScore, points, and phoneSeconds are absent — server is the sole scoring oracle.
// timestamp is injected at call time to enable server-side replay detection.

export function buildTelemetryDigest(
  state: TripState,
  startTime: string,
  endTime: string,
  // Read from TripData, not TripState — accel health is SDK trip data, not part of the
  // reducer-shaped trip state (CAR-189).
  //
  // Optional on purpose: a trip that ended with no SDK data at all knows nothing about
  // the accelerometer, and `undefined` is that. Defaulting to `false` here turned that
  // silence into the claim "the sensor was not live", which is the one thing the field
  // must never say on its own — and it disagreed with the top-level payload, which
  // sends the same values with no default at all.
  accelAvailable: boolean | undefined,
  accelInitFailed: boolean | undefined,
  accelCoverage: number | undefined,
): TelemetryDigest {
  return {
    distanceKm:               Math.round(state.distanceKm * 1000) / 1000,
    durationSeconds:          state.durationSeconds,
    hardBrakes:               state.eventCounts.HARD_BRAKE,
    aggressiveAccels:         state.eventCounts.AGGRESSIVE_ACCEL,
    sharpTurns:               state.eventCounts.SHARP_TURN,
    screenInteractionSeconds: state.screenInteractionSeconds,
    phoneMotionSeconds:       state.phoneMotionSeconds,
    startTime,
    endTime,
    timestamp:                Date.now(),
    accelAvailable,
    accelInitFailed,
    accelCoverage,
  };
}

/**
 * The body a finished trip is saved with. `tripData` is the SDK's own record of the same
 * drive and may be absent — a trip can end with the reducer state alone, and every field
 * read from it is optional in the contract for that reason.
 */
export function buildValidTripPayload(
  state: TripState,
  tripData: TripData | null,
  startTime: string,
  endTime: string,
): ValidTripPayload {
  // RFC-001 v1.5: build and sign the raw-sensor digest — no score params, the server
  // scores authoritatively. Signing failure must never block the trip from being saved,
  // so the payload goes out unsigned instead.
  let telemetryDigest:  TelemetryDigest | undefined;
  let payloadSignature: string | undefined;
  try {
    telemetryDigest  = buildTelemetryDigest(
      state, startTime, endTime,
      tripData?.accelAvailable,
      tripData?.accelInitFailed,
      tripData?.accelCoverage,
    );
    payloadSignature = signTelemetryDigest(telemetryDigest);
  } catch (sigErr) {
    console.error('[tripPayload] Digest signing failed — payload sent unsigned', sigErr);
  }

  return {
    localTripId: state.sessionId,
    startTime,
    endTime,
    distanceKm: state.distanceKm,
    durationSeconds: state.durationSeconds,
    avgScore: 0,        // server computes — placeholder only
    points: 0,          // server computes — placeholder only
    hardBrakes: state.eventCounts.HARD_BRAKE,
    aggressiveAccels: state.eventCounts.AGGRESSIVE_ACCEL,
    sharpTurns: state.eventCounts.SHARP_TURN,
    screenInteractionSeconds: state.screenInteractionSeconds,
    phoneMotionSeconds: state.phoneMotionSeconds,
    penalties: 0,         // server computes — placeholder only
    accelAvailable: tripData?.accelAvailable,
    accelInitFailed: tripData?.accelInitFailed,
    accelCoverage: tripData?.accelCoverage,
    vehicleKeyHash: tripData?.vehicleKeyHash ?? null,
    telemetryDigest,
    payloadSignature,
    routeWaypoints: tripData?.waypoints,
    events: tripData?.events?.map(e => ({
      type: e.type,
      timestamp: e.timestamp.toISOString(),
      severity: e.severity,
      speedKmh: e.speedKmh,
      location: e.location,
      peakLongitudinalG: e.peakLongitudinalG,
      peakLateralG: e.peakLateralG,
      durationMs: e.durationMs,
    })),
  };
}
