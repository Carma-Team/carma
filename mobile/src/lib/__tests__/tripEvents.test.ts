import { toDrivingEvents } from '@/lib/tripEvents'
import { DrivingEventType } from '@/lib/driving-sdk/types'
import type { TripEvent } from '@/types'

// The map renders nothing the adapter drops, and it drops silently, so the
// cases that matter here are the ones with no visible symptom other than a
// missing marker (CAR-225).

const event = (over: Partial<TripEvent>): TripEvent => ({
  id: 'e1',
  type: 'hard_brake',
  severity: 0.5,
  timestamp: '2026-06-14T08:06:00Z',
  lat: 32.07,
  lng: 34.78,
  ...over,
})

describe('toDrivingEvents', () => {
  it('maps the server PHONE_USE name onto the SDK PHONE_USAGE enum', () => {
    const [ev] = toDrivingEvents([event({ type: 'phone_use' })])
    expect(ev.type).toBe(DrivingEventType.PHONE_USAGE)
  })

  it('keeps the names that match on both sides', () => {
    const out = toDrivingEvents([event({ type: 'hard_brake' }), event({ type: 'sharp_turn' })])
    expect(out.map(e => e.type)).toEqual([
      DrivingEventType.HARD_BRAKE,
      DrivingEventType.SHARP_TURN,
    ])
  })

  it('drops a type the SDK has no enum for, rather than passing it through', () => {
    // SPEEDING exists server-side only; it has no icon or colour in the map's
    // tables, so a marker for it would be invisible.
    expect(toDrivingEvents([event({ type: 'speeding' })])).toEqual([])
  })

  it('leaves location undefined when the event was detected during a GPS gap', () => {
    const [ev] = toDrivingEvents([event({ lat: null, lng: null })])
    expect(ev.location).toBeUndefined()
  })

  it('returns an empty array for a trip with no events', () => {
    expect(toDrivingEvents(undefined)).toEqual([])
  })
})
