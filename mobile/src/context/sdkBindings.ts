/**
 * @fileoverview Trip lifecycle callbacks on the DrivingSDK
 * @module context/sdkBindings
 *
 * @description
 * Translates the SDK's trip lifecycle (`onTripStart`, `onUpdate`, `onTripEnd`) into
 * React state. Sensor plumbing only — no scoring thresholds and no server calls;
 * those live in scoringEvents.ts and tripSubmission.ts respectively.
 *
 * Owner: May (Mobile & Frontend UI Lead — driving-sdk integration)
 */
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { DrivingSDK, TripData } from '@/lib/driving-sdk'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'

interface SdkBindingsOptions {
  sdk: DrivingSDK;
  setTripState: Dispatch<SetStateAction<TripState>>;
  tripRef: MutableRefObject<TripState>;
  /** Raw TripData from onTripEnd — holds waypoints and events with locations. */
  lastTripDataRef: MutableRefObject<TripData | null>;
  onTripEnded: () => void;
}

export function useSdkBindings({
  sdk,
  setTripState,
  tripRef,
  lastTripDataRef,
  onTripEnded,
}: SdkBindingsOptions) {
  useEffect(() => {
    // Fired when any trip starts (manual or BT auto-start).
    // For manual trips, AppContext.startTrip() calls setTripState explicitly after this — that call wins.
    // For BT auto-started trips, this is the only setter, so it correctly establishes startTime + sessionId.
    sdk.onTripStart = (tripId: string) => {
      setTripState(prev => {
        if (prev.isActive) return prev;
        return { ...INITIAL_TRIP_STATE, isActive: true, startTime: new Date(), sessionId: tripId };
      });
    };

    sdk.onUpdate = (data: TripData) => {
      setTripState(prev => ({
        ...prev,
        isActive: true,
        durationSeconds: data.durationSeconds,
        distanceKm: data.distanceKm,
        touchEpochs: data.touchEpochs,
        // eventCounts is maintained by the listeners in scoringEvents.ts — not recomputed
        // here, so only events that met CARMA's conditions are counted.
        // screenInteractionSeconds likewise: data carries the SDK's ungated sum, while the
        // trip state holds only seconds above CARMA's speed gate (CAR-184). Copying it
        // here would overwrite the gated count with the raw one.
      }));
    };

    sdk.onTripEnd = (data: TripData) => {
      lastTripDataRef.current = data;
      if (tripRef.current.isActive) {
        onTripEnded();
      }
    };
  }, [sdk, setTripState, tripRef, lastTripDataRef, onTripEnded]);
}
