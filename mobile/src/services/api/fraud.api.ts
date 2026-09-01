/**
 * @fileoverview API for reporting invalid trips / suspected fraud
 * @module services/api/fraud
 *
 * @description
 * `syncInvalidTrip` — converts the SDK FraudDetectedEvent to the server format and posts to the backend.
 * In mock mode (USE_REAL_SERVER=false): logs formatted JSON and returns a stub DTO.
 *
 * Field names are the same at every layer, from FraudDetector through to the
 * fraud_reports row. Anything renamed on the way through can no longer be traced
 * back to the rule that produced it.
 *
 * @server POST /api/fraud — live (server/app/routers/fraud.py)
 */
import { request } from './client';
import { USE_REAL_SERVER } from '@/constants/serverConfig';
import type { FraudSignals } from '@/lib/FraudDetector';

// ─── Mobile SDK event shape (emitted by DrivingSDK.onFraudDetected) ──────────

export interface FraudEventPayload {
  userId: string;
  timestamp: string;
  // A string, not the TransportMode enum: the SDK hands the mode over as an opaque label
  // (it holds no transport vocabulary of its own), and the wire contract underneath is
  // already `str | None` — see FraudReportIn.detected_mode. Narrowing it here would only
  // pretend to an enforcement neither side performs.
  detectedMode: string;
  fraudScore: number;
  telemetry: {
    avgSpeedKmh: number;
    maxLateralAccelG: number;
    yawVariance: number;
  };
  /** Which gates fired. Optional until the SDK carries it across its own boundary — CAR-134. */
  signals?: FraudSignals;
  /** Weight of the evidence that could be evaluated at all (§3.4) — same optionality as `signals`. */
  confidence?: number;
  /** Per-sensor availability so a stored report explains its own unknowns. Same optionality as `signals`. */
  sensorAvailability?: {
    gps: boolean;
    accelerometer: boolean | null;
    gyroscope: boolean | null;
  };
  durationMs: number;
  maxSpeedKmh: number;
  /** Absent for a pre-trip rejection — the trip was never confirmed, so no distance exists. */
  distanceKm?: number;
}

// ─── Server response (FraudReportOut — camelCase per CamelModel) ──────────────

export interface FraudReportOut {
  id: string;
  userId: string;
  reportedAt: string;
  anomalyFlags: string[];
}

// ─── Reason codes ────────────────────────────────────────────────────────────

// The gates that fired, as flags, so "which rule caught this" is answerable with
// a query on anomaly_flags instead of a scan through stored evidence.
function signalFlags(signals?: FraudSignals): string[] {
  if (!signals) return [];
  return [
    signals.constantHighSpeed && 'SIGNAL_CONSTANT_HIGH_SPEED',
    signals.noLateralForce    && 'SIGNAL_NO_LATERAL_FORCE',
    signals.noHeadingChange   && 'SIGNAL_NO_HEADING_CHANGE',
  ].filter((flag): flag is string => Boolean(flag));
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const fraudApi = {
  syncInvalidTrip: async (payload: FraudEventPayload): Promise<FraudReportOut> => {
    if (!USE_REAL_SERVER) {
      console.group('[fraud.api] INVALID TRIP DETECTED');
      console.log('Mode:', payload.detectedMode, `| Score: ${(payload.fraudScore * 100).toFixed(0)}%`);
      console.log('Signals fired:', signalFlags(payload.signals).join(', ') || 'none reported');
      console.log('Telemetry:', JSON.stringify(payload.telemetry, null, 2));
      console.log('Full payload:', JSON.stringify(payload, null, 2));
      console.groupEnd();
      return {
        id: `dev_fraud_${Date.now()}`,
        userId: payload.userId,
        reportedAt: payload.timestamp,
        anomalyFlags: [`TRANSPORT_MODE_${payload.detectedMode}`],
      };
    }

    // Map SDK event to server's InvalidTripPayload schema
    const serverPayload = {
      idempotencyKey: `fraud_${payload.userId}_${payload.timestamp}`,
      tripDurationSeconds: Math.round(payload.durationMs / 1000),
      distanceKm: payload.distanceKm,
      anomalyFlags: [
        `TRANSPORT_MODE_${payload.detectedMode}`,
        ...(payload.fraudScore > 0.8 ? ['HIGH_FRAUD_SCORE'] : []),
        ...signalFlags(payload.signals),
      ],
      detection: {
        fraudScore: payload.fraudScore,
        detectedMode: payload.detectedMode,
        signals: payload.signals,
        confidence: payload.confidence,
        sensorAvailability: payload.sensorAvailability,
        telemetry: payload.telemetry,
        maxSpeedKmh: payload.maxSpeedKmh,
        detectedAt: payload.timestamp,
      },
    };

    try {
      return await request<FraudReportOut>('/api/fraud', {
        method: 'POST',
        body: JSON.stringify(serverPayload),
      });
    } catch {
      console.warn('[fraud.api] syncInvalidTrip failed silently');
      return { id: 'failed', userId: payload.userId, reportedAt: payload.timestamp, anomalyFlags: [] };
    }
  },
};
