/**
 * @fileoverview API for reporting invalid trips / suspected fraud
 * @module services/api/fraud
 *
 * @description
 * `syncInvalidTrip` — converts the SDK FraudDetectedEvent to the server format and posts to the backend.
 * In mock mode (USE_REAL_SERVER=false): logs formatted JSON and returns a stub DTO.
 *
 * @server POST /api/fraud — live (server/app/routers/fraud.py)
 */
import { request } from './client';
import { USE_REAL_SERVER } from '@/constants/serverConfig';
import { TransportMode } from '@/lib/driving-sdk/types';

// ─── Mobile SDK event shape (emitted by DrivingSDK.onFraudDetected) ──────────

export interface FraudEventPayload {
  userId: string;
  timestamp: string;
  detectedMode: TransportMode;
  fraudScore: number;
  telemetrySummary: {
    avgSpeed: number;
    maxLateralAccel: number;
    gyroVariance: number;
  };
  durationMs: number;
  maxSpeedKmh: number;
}

// ─── Server response (FraudReportOut — camelCase per CamelModel) ──────────────

export interface FraudReportOut {
  id: string;
  userId: string;
  reportedAt: string;
  anomalyFlags: string[];
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const fraudApi = {
  syncInvalidTrip: async (payload: FraudEventPayload): Promise<FraudReportOut> => {
    if (!USE_REAL_SERVER) {
      console.group('[fraud.api] INVALID TRIP DETECTED');
      console.log('Mode:', payload.detectedMode, `| Score: ${(payload.fraudScore * 100).toFixed(0)}%`);
      console.log('Telemetry:', JSON.stringify(payload.telemetrySummary, null, 2));
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
      anomalyFlags: [
        `TRANSPORT_MODE_${payload.detectedMode}`,
        ...(payload.fraudScore > 0.8 ? ['HIGH_CONFIDENCE_FRAUD'] : []),
      ],
      rawPayload: {
        fraudScore: payload.fraudScore,
        maxSpeedKmh: payload.maxSpeedKmh,
        telemetrySummary: payload.telemetrySummary,
        timestamp: payload.timestamp,
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
