/**
 * @fileoverview Fraud detection handler
 * @module context/fraudBinding
 *
 * @description
 * Fires when TripValidationManager detects non-car transport (Rule 3). The SDK has
 * already aborted the session silently by this point — the work here is state
 * cleanup plus reporting the rejected session to the server.
 *
 * @server
 * - `fraudApi.syncInvalidTrip()` — POST /api/trips/invalid
 *
 * Owner: Dan (CPO — anti-fraud mechanics)
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { DrivingSDK } from '@/lib/driving-sdk'
import type { FraudDetectedEvent } from '@/lib/driving-sdk/types'
import { fraudApi } from '@/services/api/fraud.api'
import type { AppUser } from '@/types'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'

export function useFraudBinding(
  sdk: DrivingSDK,
  user: AppUser | null,
  setTripState: Dispatch<SetStateAction<TripState>>,
) {
  useEffect(() => {
    sdk.onFraudDetected = (event: FraudDetectedEvent) => {
      // Discard any accumulated trip data — fraudulent sessions earn zero CARMA Points
      setTripState(INITIAL_TRIP_STATE);

      // TODO: Mai — implement "public transport trip detected" toast/modal component

      // Report to Sean's backend (non-blocking — failure must never affect the user flow)
      fraudApi.syncInvalidTrip({
        userId: user?.id ?? 'anonymous',
        timestamp: new Date().toISOString(),
        detectedMode: event.mode,
        fraudScore: event.confidence,
        telemetry: event.telemetry,
        durationMs: event.durationMs,
        maxSpeedKmh: event.maxSpeedKmh,
      }).catch(() => {});
    };
  }, [sdk, user, setTripState]);
}
