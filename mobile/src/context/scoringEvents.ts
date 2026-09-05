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
import { DrivingSDK, DrivingEventType, type InteractionData } from '@/lib/driving-sdk'
import type { TripState } from './tripState'

// Phone handling below this speed is not distraction CARMA scores — the driver is
// stopped or crawling. Same threshold as the HARD_BRAKE / AGGRESSIVE_ACCEL gates below,
// and same `>=` semantics as the SDK's `minSpeedKmh` condition.
const INTERACTION_MIN_SPEED_KMH = 15;

/**
 * Accumulates the two distraction counters, counting a second only when its stamped
 * speed clears the gate. The SDK deliberately emits every second regardless of speed
 * (CAR-175), so this is the only place the speed rule is applied. The SDK has already
 * made them mutually exclusive, so at most one of the two moves per sample.
 */
export function nextInteractionSeconds(
  prev: { screenInteractionSeconds: number; phoneMotionSeconds: number },
  sample: InteractionData,
): { screenInteractionSeconds: number; phoneMotionSeconds: number } {
  if (sample.speedKmh < INTERACTION_MIN_SPEED_KMH) return prev;
  return {
    screenInteractionSeconds: prev.screenInteractionSeconds + sample.screenInteractionSeconds,
    phoneMotionSeconds: prev.phoneMotionSeconds + sample.phoneMotionSeconds,
  };
}

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
      sdk.on(DrivingEventType.AGGRESSIVE_ACCEL, { minSpeedKmh: 15 }, () => {
        setTripState(prev => ({
          ...prev,
          eventCounts: { ...prev.eventCounts, AGGRESSIVE_ACCEL: prev.eventCounts.AGGRESSIVE_ACCEL + 1 },
        }));
      }),
      sdk.on(DrivingEventType.SHARP_TURN, { minSpeedKmh: 25 }, () => {
        setTripState(prev => ({
          ...prev,
          eventCounts: { ...prev.eventCounts, SHARP_TURN: prev.eventCounts.SHARP_TURN + 1 },
        }));
      }),
      // PHONE_USAGE has no listener here — distraction for scoring and display comes
      // from the two per-second counters below, not from a discrete event count. The
      // event itself is kept for the trip map. See #43.
    ];

    // Per-second phone-handling samples are not sensor events, so they arrive on their
    // own callback rather than through on()/off().
    sdk.onInteractionData = (data) => {
      setTripState(prev => ({ ...prev, ...nextInteractionSeconds(prev, data) }));
    };

    return () => {
      tokens.forEach(token => sdk.off(token));
      sdk.onInteractionData = undefined;
    };
  }, [sdk, setTripState]);
}
