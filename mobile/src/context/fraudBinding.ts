/**
 * @fileoverview Fraud detection handler
 * @module context/fraudBinding
 *
 * @description
 * Fires when TripValidationManager detects non-car transport (Rule 3). The SDK has
 * already aborted the session by this point — the work here is state cleanup, telling
 * the driver why the trip was dropped (§3.7), and reporting the rejected session to
 * the server.
 *
 * @server
 * - `fraudApi.syncInvalidTrip()` — POST /api/trips/invalid
 *
 * Owner: Dan (CPO — anti-fraud mechanics)
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { DrivingSDK } from '@/lib/driving-sdk'
import type { FraudDetectedEvent } from '@/lib/driving-sdk/types'
import type { FraudSignals } from '@/lib/FraudDetector'
import { fraudApi } from '@/services/api/fraud.api'
import type { AppUser, Language, ToastMessage } from '@/types'
import he from '@/i18n/he'
import en from '@/i18n/en'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'

export function useFraudBinding(
  sdk: DrivingSDK,
  user: AppUser | null,
  setTripState: Dispatch<SetStateAction<TripState>>,
  addToast: (toast: Omit<ToastMessage, 'id'>) => void,
  lang: Language,
) {
  useEffect(() => {
    sdk.onFraudDetected = (event: FraudDetectedEvent) => {
      // Discard any accumulated trip data — fraudulent sessions earn zero CARMA Points
      setTripState(INITIAL_TRIP_STATE);

      // §3.7: a decline that says nothing is indistinguishable from a bug, and that is
      // exactly what a false positive looks like to a driver who really was driving. The
      // message names the reason; the path to dispute it waits on the Section 5 ladder.
      // Longer than a default toast: this one is the only account of a trip that will
      // never appear anywhere else.
      const tr = lang === 'EN' ? en : he;
      addToast({
        type: 'warning',
        title: tr.fraud.declinedTitle,
        message: tr.fraud.declinedMessage,
        duration: 8000,
      });

      // Report to Sean's backend (non-blocking — failure must never affect the user flow)
      fraudApi.syncInvalidTrip({
        userId: user?.id ?? 'anonymous',
        timestamp: new Date().toISOString(),
        detectedMode: event.detectedMode,
        fraudScore: event.fraudScore,
        telemetry: event.telemetry,
        // The SDK carries the gates as an untyped map so no CARMA type crosses into
        // the library; this side of the boundary is where they get their name back.
        signals: event.signals as FraudSignals | undefined,
        durationMs: event.durationMs,
        maxSpeedKmh: event.maxSpeedKmh,
        distanceKm: event.distanceKm,
      }).catch(() => {});
    };
  }, [sdk, user, setTripState, addToast, lang]);
}
