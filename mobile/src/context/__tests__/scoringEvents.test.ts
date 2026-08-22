import { nextInteractionSeconds } from '@/context/scoringEvents'
import type { InteractionData } from '@/lib/driving-sdk'

// scoringEvents imports the SDK entry point, which reaches expo-task-manager through
// SensorManager and has no native module under jest. The gate below needs none of it.
jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({ SensorManager: class {} }))

const sample = (speedKmh: number, handheld: 0 | 1 = 1): InteractionData => ({
  touchEpochs: 0,
  screenInteractionSeconds: handheld,
  speedKmh,
})

// ─── nextInteractionSeconds ───────────────────────────────────────────────────

describe('nextInteractionSeconds', () => {
  it('ignores a hand-held second below 15 km/h', () => {
    expect(nextInteractionSeconds(0, sample(10))).toBe(0)
  })

  it('counts a hand-held second above 15 km/h', () => {
    expect(nextInteractionSeconds(0, sample(20))).toBe(1)
  })

  it('counts a hand-held second exactly at the 15 km/h gate', () => {
    expect(nextInteractionSeconds(0, sample(15))).toBe(1)
  })

  it('adds nothing for a second that was not hand-held, whatever the speed', () => {
    expect(nextInteractionSeconds(3, sample(80, 0))).toBe(3)
  })

  it('accumulates across seconds, skipping the gated ones', () => {
    const seconds = [sample(20), sample(5), sample(20)]
    expect(seconds.reduce(nextInteractionSeconds, 0)).toBe(2)
  })
})
