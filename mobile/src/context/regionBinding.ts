/**
 * @fileoverview Region-rejection handler — regionBinding
 * @module context/regionBinding
 *
 * @description
 * Fires when TripValidationManager rejects a trip for starting outside Israel
 * (CAR-23). The SDK has already discarded the session silently by this point —
 * the work here is state cleanup plus telling the driver, nothing else. Unlike
 * fraud rejection, there is no server call: the trip never happened as far as
 * CARMA is concerned.
 *
 * Owner: May (Mobile & Frontend Lead)
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { DrivingSDK } from '@/lib/driving-sdk'
import type { Language, ToastMessage } from '@/types'
import he from '@/i18n/he'
import en from '@/i18n/en'
import { INITIAL_TRIP_STATE, type TripState } from './tripState'

export function useRegionBinding(
  sdk: DrivingSDK,
  setTripState: Dispatch<SetStateAction<TripState>>,
  addToast: (toast: Omit<ToastMessage, 'id'>) => void,
  lang: Language,
) {
  useEffect(() => {
    sdk.onRegionRejected = () => {
      setTripState(INITIAL_TRIP_STATE);
      const tr = lang === 'EN' ? en : he;
      addToast({ type: 'error', title: tr.deviceGate.regionTitle, message: tr.deviceGate.regionMessage });
    };
  }, [sdk, setTripState, addToast, lang]);
}
