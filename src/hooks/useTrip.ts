import { useApp } from '@/context/AppContext';

/**
 * Hook simplified to act as a proxy for the Global Trip Context.
 * All logic now resides in AppContext to ensure consistency across screens.
 */
export function useTrip() {
  const { tripState, startTrip, endTrip } = useApp();

  return {
    state: tripState,
    startTrip,
    endTrip
  };
}
