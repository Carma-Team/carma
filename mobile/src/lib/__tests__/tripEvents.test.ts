import { eventMarkerText, toDrivingEvents } from '@/lib/tripEvents'
import { DrivingEventType, type DrivingEvent } from '@/lib/driving-sdk/types'
import type { TripEvent } from '@/types'

// The marker callout is the only place these two fields are read, so the test asserts
// the label mapping and the "speed only when the SDK stamped one" rule.
const t = (key: string) => key

function drivingEvent(over: Partial<DrivingEvent> = {}): DrivingEvent {
  return {
    type: DrivingEventType.PHONE_USAGE,
    timestamp: new Date('2026-08-23T14:32:00Z'),
    ...over,
  }
}

describe('eventMarkerText', () => {
  it('titles the marker with the trip label of its event type', () => {
    expect(eventMarkerText(drivingEvent({ type: DrivingEventType.HARD_BRAKE }), t).title).toBe('trip.hardBrakes')
    expect(eventMarkerText(drivingEvent(), t).title).toBe('trip.phoneUsage')
  })

  it('appends the speed only when the event carries one', () => {
    const [withSpeed] = eventMarkerText(drivingEvent({ speedKmh: 61.6 }), t).description.split('\n')
    expect(withSpeed).toContain('62 trip.kmh')

    const [noSpeed] = eventMarkerText(drivingEvent(), t).description.split('\n')
    expect(noSpeed).not.toContain('trip.kmh')
    expect(noSpeed).toMatch(/^\d{2}:\d{2}$/)
  })

  it('closes the description with the line that explains the callout press', () => {
    const lines = eventMarkerText(drivingEvent(), t).description.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('trip.openLocationInMaps')
  })
})

// The map renders nothing the adapter drops, and it drops silently, so the
// cases that matter here are the ones with no visible symptom other than a
// missing marker (CAR-225).

// severity is on the server's scale on purpose -- 1.0-3.0, per scoring.md §3.4.
const event = (over: Partial<TripEvent> = {}): TripEvent => ({
  id: 'e1',
  type: 'hard_brake',
  severity: 2.4,
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
    // SPEEDING exists server-side only -- there is no DrivingEventType member
    // to map it onto, so adding a map entry for it would not bring it through.
    expect(toDrivingEvents([event({ type: 'speeding' })])).toEqual([])
  })

  // CAR-210. The field is optional on DrivingEvent, so a wrong value here compiles
  // and reads back as a plausible number -- nothing but this assertion catches it.
  it('leaves severity unset -- the server sends 1-3, the SDK field means 0-1', () => {
    expect(toDrivingEvents([event()])[0].severity).toBeUndefined()
  })

  it('nests flat coordinates under location', () => {
    expect(toDrivingEvents([event()])[0].location).toEqual({ latitude: 32.07, longitude: 34.78 })
  })

  it('leaves location undefined when the event was detected during a GPS gap', () => {
    const [ev] = toDrivingEvents([event({ lat: null, lng: null })])
    expect(ev.location).toBeUndefined()
  })

  it('returns an empty array for a trip with no events', () => {
    expect(toDrivingEvents(undefined)).toEqual([])
  })
})
