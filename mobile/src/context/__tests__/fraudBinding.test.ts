import { renderHook } from '@testing-library/react-native'
import { useFraudBinding } from '@/context/fraudBinding'
import type { DrivingSDK } from '@/lib/driving-sdk'
import type { FraudDetectedEvent } from '@/lib/driving-sdk/types'
import { TransportMode } from '@/lib/transportMode'
import he from '@/i18n/he'
import en from '@/i18n/en'

// The binding reaches the SDK entry point, which pulls expo-task-manager in through
// SensorManager and has no native module under jest. Nothing here needs the real one.
jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({ SensorManager: class {} }))
jest.mock('@/services/api/fraud.api', () => ({
  fraudApi: { syncInvalidTrip: jest.fn().mockResolvedValue(undefined) },
}))

const event = {
  detectedMode: TransportMode.TRAIN,
  fraudScore: 0.9,
  telemetry: { avgSpeedKmh: 90, maxLateralAccelG: 0.01, yawVariance: 0 },
  durationMs: 120_000,
  maxSpeedKmh: 110,
  distanceKm: 3,
} as unknown as FraudDetectedEvent

function bind(lang: 'HE' | 'EN') {
  const sdk = {} as DrivingSDK
  const addToast = jest.fn()
  renderHook(() => useFraudBinding(sdk, null, jest.fn(), addToast, lang))
  return { sdk, addToast }
}

describe('useFraudBinding — telling the driver (§3.7)', () => {
  it('names the reason the trip was dropped, in Hebrew', () => {
    const { sdk, addToast } = bind('HE')

    sdk.onFraudDetected!(event)

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: he.fraud.declinedTitle, message: he.fraud.declinedMessage })
    )
  })

  it('follows the selected language', () => {
    const { sdk, addToast } = bind('EN')

    sdk.onFraudDetected!(event)

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: en.fraud.declinedTitle })
    )
  })

  it('reports the session to the server as well as telling the driver', () => {
    const { fraudApi } = require('@/services/api/fraud.api')
    const { sdk, addToast } = bind('HE')

    sdk.onFraudDetected!(event)

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(fraudApi.syncInvalidTrip).toHaveBeenCalled()
  })
})
