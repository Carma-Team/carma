import { eventMarkerText, toDrivingEvents } from '@/lib/tripEvents'
import { DrivingEventType, type DrivingEvent } from '@/lib/driving-sdk/types'

// The marker callout is the only place these two fields are read, so the test asserts
// the label mapping and the "speed only when the SDK stamped one" rule.
const t = (key: string) => key

function event(over: Partial<DrivingEvent> = {}): DrivingEvent {
  return {
    type: DrivingEventType.PHONE_USAGE,
    timestamp: new Date('2026-08-23T14:32:00Z'),
    ...over,
  }
}

describe('eventMarkerText', () => {
  it('titles the marker with the trip label of its event type', () => {
    expect(eventMarkerText(event({ type: DrivingEventType.HARD_BRAKE }), t).title).toBe('trip.hardBrakes')
    expect(eventMarkerText(event(), t).title).toBe('trip.phoneUsage')
  })

  it('appends the speed only when the event carries one', () => {
    const [withSpeed] = eventMarkerText(event({ speedKmh: 61.6 }), t).description.split('\n')
    expect(withSpeed).toContain('62 trip.kmh')

    const [noSpeed] = eventMarkerText(event(), t).description.split('\n')
    expect(noSpeed).not.toContain('trip.kmh')
    expect(noSpeed).toMatch(/^\d{2}:\d{2}$/)
  })

  it('closes the description with the line that explains the callout press', () => {
    const lines = eventMarkerText(event(), t).description.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('trip.openLocationInMaps')
  })
})

describe('toDrivingEvents', () => {
  it('drops an unknown type and keeps a known one without coordinates', () => {
    const events = toDrivingEvents([
      { id: '1', type: 'not_a_thing', timestamp: '2026-08-23T14:32:00Z', severity: 0.5, lat: null, lng: null },
      { id: '2', type: 'hard_brake',  timestamp: '2026-08-23T14:33:00Z', severity: 0.5, lat: null, lng: null },
    ])

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(DrivingEventType.HARD_BRAKE)
    expect(events[0].location).toBeUndefined()
  })
})
