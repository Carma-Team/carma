/**
 * Two things the card decides on its own: which sync state a row is in, and the event
 * row, which never appeared.
 *
 * The row counted `eventsArray`, a hand-written `any[]` with no schema counterpart that
 * nothing ever wrote — so it was dead while the counts sat on the trip in three
 * separate fields the whole time (CAR-271).
 */
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { TripCard } from '@/components/driving/TripCard'
import he from '@/i18n/he'
import type { Trip } from '@/types'

// The real hook reads the app context, which pulls in the driving SDK. The card only
// needs a language and a lookup, so both are supplied directly.
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'HE',
    t: (key: string) =>
      key.split('.').reduce<any>((node, part) => node?.[part], require('@/i18n/he').default),
  }),
}))

const trip = (overrides: Partial<Trip> = {}): Trip =>
  ({
    id: 't1',
    startTime: '2026-09-01T08:00:00Z',
    distanceKm: 12.4,
    avgScore: 88,
    points: 30,
    hardBrakes: 0,
    aggressiveAccels: 0,
    sharpTurns: 0,
    ...overrides,
  }) as Trip

const eventRow = () => screen.queryByText(new RegExp(`\\d+ ${he.trip.events}`))

describe('TripCard — sync state', () => {
  test('a synced trip shows its score and the points it earned', () => {
    render(<TripCard trip={trip()} />)

    expect(screen.getByText('88')).toBeTruthy()
    expect(screen.queryByText(he.trip.syncPending)).toBeNull()
    expect(screen.queryByText(he.trip.syncFailed)).toBeNull()
  })

  // A queued row carries zeros until the server scores it, so the grade badge would
  // read as a real zero — the reason the score is withheld rather than shown as 0.
  test('a trip still waiting to be sent shows that instead of a zero score', () => {
    render(<TripCard trip={trip({ avgScore: 0, points: 0, pendingSync: true })} />)

    expect(screen.getByText(he.trip.syncPending)).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  test('a trip the queue gave up on is shown apart from one still trying', () => {
    render(<TripCard trip={trip({ avgScore: 0, points: 0, syncFailed: true })} />)

    expect(screen.getByText(he.trip.syncFailed)).toBeTruthy()
    expect(screen.queryByText(he.trip.syncPending)).toBeNull()
  })

  // The queue flags the row it gave up on without clearing the one it was queued with.
  test('a trip carrying both flags is shown as given up on', () => {
    render(<TripCard trip={trip({ pendingSync: true, syncFailed: true })} />)

    expect(screen.getByText(he.trip.syncFailed)).toBeTruthy()
    expect(screen.queryByText(he.trip.syncPending)).toBeNull()
  })
})

describe('TripCard event row', () => {
  it('sums the three counters the trip carries', () => {
    render(<TripCard trip={trip({ hardBrakes: 2, aggressiveAccels: 1, sharpTurns: 3 })} />)
    expect(screen.getByText(`6 ${he.trip.events}`)).toBeTruthy()
  })

  it('stays away when nothing was detected', () => {
    render(<TripCard trip={trip()} />)
    expect(eventRow()).toBeNull()
  })
})
