/**
 * The event row, which never appeared.
 *
 * It counted `eventsArray`, a hand-written `any[]` with no schema counterpart that
 * nothing ever wrote — so the row was dead while the counts sat on the trip in three
 * separate fields the whole time (CAR-271).
 */
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { TripCard } from '@/components/driving/TripCard'
import he from '@/i18n/he'
import type { Trip } from '@/types'

jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const trip = (over: Partial<Trip> = {}): Trip =>
  ({
    id: 't1',
    startTime: '2026-09-01T08:00:00Z',
    distanceKm: 12.4,
    avgScore: 88,
    points: 40,
    hardBrakes: 0,
    aggressiveAccels: 0,
    sharpTurns: 0,
    ...over,
  }) as Trip

const eventRow = () => screen.queryByText(new RegExp(`\\d+ ${he.trip.events}`))

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
