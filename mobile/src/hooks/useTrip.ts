/**
 * @fileoverview Lightweight trip access hook — useTrip
 * @module hooks/useTrip
 *
 * @description
 * Thin proxy over AppContext that exposes only the trip-related fields:
 * `state` (TripState), `startTrip`, `endTrip`.
 * All real logic lives in AppContext.processEndTrip.
 *
 * @remarks No direct server calls — see AppContext for trip persistence.
 */
import { useApp } from '@/context/AppContext';
export function useTrip() {
  const { tripState, startTrip, endTrip } = useApp();

  return {
    state: tripState,
    startTrip,
    endTrip
  };
}
