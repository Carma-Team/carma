/**
 * @fileoverview API לדיווח על נסיעות לא תקינות / חשד להונאה
 * @module services/api/fraud
 *
 * @description
 * `syncInvalidTrip` — שולח DTO מלא לשרת נווה לצורך ניתוח מטריקות הונאה ושמירת DB.
 * בmock mode (USE_REAL_SERVER=false): ממיר ל-JSON מעוצב + מחזיר token מדומה.
 *
 * @server
 * - POST /api/fraud/trips — TODO: Sean to implement (see InvalidTripPayload for DB schema)
 */
import { request } from './client';
import { USE_REAL_SERVER } from '@/constants/serverConfig';

// ─── DTO (matches Sean's future DB schema) ───────────────────────────────────

export interface InvalidTripPayload {
  userId: string;                        // driver identifier for auditing
  timestamp: string;                     // ISO — when fraud was detected
  detectedMode: 'TRAIN' | 'BUS' | 'UNKNOWN'; // classified transport type
  fraudScore: number;                    // 0–1 composite score from FraudDetector
  telemetrySummary: {
    avgSpeed: number;                    // km/h — average over detection window
    maxLateralAccel: number;             // g-units — peak gravity-removed lateral force
    gyroVariance: number;                // rad²/s² — yaw rate variance
  };
  durationMs: number;                    // how long the session ran before rejection
  maxSpeedKmh: number;                   // peak speed seen during the session
}

export interface SyncInvalidTripResponse {
  token: string;                         // server-assigned audit record ID
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const fraudApi = {
  syncInvalidTrip: async (payload: InvalidTripPayload): Promise<SyncInvalidTripResponse> => {
    if (!USE_REAL_SERVER) {
      // Dev mode: log the full DTO and resolve immediately — no network call
      console.group('[fraud.api] INVALID TRIP DETECTED');
      console.log('Mode:', payload.detectedMode, `| Score: ${(payload.fraudScore * 100).toFixed(0)}%`);
      console.log('Telemetry:', JSON.stringify(payload.telemetrySummary, null, 2));
      console.log('Full payload:', JSON.stringify(payload, null, 2));
      console.groupEnd();
      return { token: `dev_fraud_${Date.now()}` };
    }

    try {
      // TODO: Sean to implement POST /api/fraud/trips on the server
      return await request<SyncInvalidTripResponse>('/api/fraud/trips', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch {
      // Non-blocking — fraud sync failure must never interrupt the user flow
      console.warn('[fraud.api] syncInvalidTrip failed silently (server not ready yet)');
      return { token: 'failed' };
    }
  },
};
