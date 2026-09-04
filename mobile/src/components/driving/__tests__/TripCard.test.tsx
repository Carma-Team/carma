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
    ...overrides,
  }) as Trip

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
