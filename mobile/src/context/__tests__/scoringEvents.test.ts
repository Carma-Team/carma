import { nextInteractionSeconds } from '@/context/scoringEvents'
import type { InteractionData } from '@/lib/driving-sdk'

// scoringEvents imports the SDK entry point, which reaches expo-task-manager through
// SensorManager and has no native module under jest. The gate below needs none of it.
jest.mock('@/lib/driving-sdk/sensors/SensorManager', () => ({ SensorManager: class {} }))

type Counters = { screenInteractionSeconds: number; phoneMotionSeconds: number }

const ZERO: Counters = { screenInteractionSeconds: 0, phoneMotionSeconds: 0 }

const sample = (speedKmh: number, screen: 0 | 1 = 1, motion: 0 | 1 = 0): InteractionData => ({
  screenInteractionSeconds: screen,
  phoneMotionSeconds: motion,
  speedKmh,
})

// ─── nextInteractionSeconds ───────────────────────────────────────────────────

describe('nextInteractionSeconds', () => {
  it('ignores a distracted second below 15 km/h', () => {
    expect(nextInteractionSeconds(ZERO, sample(10))).toEqual(ZERO)
  })

  it('counts a distracted second above 15 km/h', () => {
    expect(nextInteractionSeconds(ZERO, sample(20))).toEqual({ screenInteractionSeconds: 1, phoneMotionSeconds: 0 })
  })

  it('counts a distracted second exactly at the 15 km/h gate', () => {
    expect(nextInteractionSeconds(ZERO, sample(15))).toEqual({ screenInteractionSeconds: 1, phoneMotionSeconds: 0 })
  })

  it('gates phone motion on the same speed as screen interaction', () => {
    expect(nextInteractionSeconds(ZERO, sample(10, 0, 1))).toEqual(ZERO)
    expect(nextInteractionSeconds(ZERO, sample(20, 0, 1))).toEqual({ screenInteractionSeconds: 0, phoneMotionSeconds: 1 })
  })

  it('adds nothing for an undistracted second, whatever the speed', () => {
    const prev = { screenInteractionSeconds: 3, phoneMotionSeconds: 2 }
    expect(nextInteractionSeconds(prev, sample(80, 0, 0))).toEqual(prev)
  })

  it('accumulates across seconds, skipping the gated ones', () => {
    const seconds = [sample(20), sample(5), sample(20, 0, 1)]
    expect(seconds.reduce<Counters>(nextInteractionSeconds, ZERO))
      .toEqual({ screenInteractionSeconds: 1, phoneMotionSeconds: 1 })
  })
})
