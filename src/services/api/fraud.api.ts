/**
 * @fileoverview API לדיווח על נסיעות לא תקינות / חשד להונאה
 * @module services/api/fraud
 *
 * @description
 * `syncInvalidTrip` — שולח payload לשרת נווה לצורך ניתוח מטריקות הונאה.
 * כרגע stub בלבד (לוגים בלבד). Sean יממש את ה-endpoint בצד השרת.
 *
 * @server
 * - POST /api/fraud/trips — TODO: Sean to implement
 * - Payload: InvalidTripPayload
 */
import { request } from './client';

export type InvalidTripReason =
  | 'TRIP_TOO_SHORT'          // Rule 1: never reached 30s above threshold
  | 'NON_CAR_TRANSPORT'       // Rule 3: classified as train / bus
  | 'SPEED_ANOMALY'           // impossible speed for road vehicle
  | 'SENSOR_MANIPULATION';    // Phase 2+: static accel during claimed movement

export interface InvalidTripPayload {
  reason: InvalidTripReason;
  transportMode: 'CAR' | 'TRAIN' | 'UNKNOWN';
  fraudConfidence: number;      // 0–1
  durationMs: number;           // how long the session lasted before rejection
  maxSpeedKmh: number;
  timestamp: string;            // ISO — when the rejection occurred
  userId?: string;
}

export const fraudApi = {
  syncInvalidTrip: async (payload: InvalidTripPayload): Promise<void> => {
    console.log('[API] Syncing invalid/fraudulent trip to backend for auditing...', payload);
    try {
      // TODO: Sean to implement POST /api/fraud/trips on the server
      await request<void>('/api/fraud/trips', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch {
      // Non-blocking — fraud sync failure must never interrupt the user flow
      console.warn('[API] fraud.syncInvalidTrip failed silently (server not ready yet)');
    }
  },
};
