/**
 * @fileoverview CARMA scoring event listeners on the DrivingSDK
 * @module context/scoringEvents
 *
 * @description
 * Registers conditional listeners on the generic DrivingSDK and maintains the
 * per-trip event counters. The speed gates below are CARMA's scoring thresholds —
 * they are application policy, not sensor behaviour, which is why they live here
 * and not inside src/lib/driving-sdk/.
 *
 * Owner: Dan (CPO — CARMA Score algorithm and scoring thresholds)
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { DrivingSDK, DrivingEventType } from '@/lib/driving-sdk'
import type { TripState } from './tripState'

export function useScoringEvents(
  sdk: DrivingSDK,
  setTripState: Dispatch<SetStateAction<TripState>>,
) {
  useEffect(() => {
    const tokens = [
      sdk.on(DrivingEventType.HARD_BRAKE, { minSpeedKmh: 15 }, () => {
        setTripState(prev => ({
          ...prev,
          eventCounts: { ...prev.eventCounts, HARD_BRAKE: prev.eventCounts.HARD_BRAKE + 1 },
        }));
      }),
      sdk.on(DrivingEventType.AGGRESSIVE_ACCEL, { minSpeedKmh: 5 }, () => {
        setTripState(prev => ({
          ...prev,
          eventCounts: { ...prev.eventCounts, AGGRESSIVE_ACCEL: prev.eventCounts.AGGRESSIVE_ACCEL + 1 },
        }));
      }),
      sdk.on(DrivingEventType.SHARP_TURN, { minSpeedKmh: 10 }, () => {
        setTripState(prev => ({
          ...prev,
          eventCounts: { ...prev.eventCounts, SHARP_TURN: prev.eventCounts.SHARP_TURN + 1 },
        }));
      }),
      // EVT_SWERVE disabled — uncomment when re-enabling detection + UI display
      // sdk.on(DrivingEventType.SWERVE, { minSpeedKmh: 15 }, () => {
      //   setTripState(prev => ({
      //     ...prev,
      //     eventCounts: { ...prev.eventCounts, SWERVE: prev.eventCounts.SWERVE + 1 },
      //   }));
      // }),
      // PHONE_USAGE has no listener here — "phone touches" for scoring/display comes
      // from the SDK's IMU-based touchEpochs (tripState.touchEpochs), not a discrete
      // event count. See #43.
    ];
    return () => tokens.forEach(token => sdk.off(token));
  }, [sdk, setTripState]);
}
