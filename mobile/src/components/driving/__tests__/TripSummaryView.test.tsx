import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { TripSummaryView } from '@/components/driving/TripSummaryView'
import { TOO_SHORT_SUMMARY } from '@/lib/tripSummary'
import type { TripSummary } from '@/lib/tripSummary'
import he from '@/i18n/he'

// The real context builds the driving SDK; the map needs a native module that is
// only linked in a device build. Neither is what this screen is being tested for.
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))
jest.mock('react-native-maps', () => ({ __esModule: true, default: 'MapView', Polyline: 'Polyline', Marker: 'Marker' }))

const summary = (over: Partial<TripSummary> = {}): TripSummary => ({
  id: 't1',
  state: 'scored',
  score: 87,
  points: 42,
  distanceKm: 12.5,
  durationSeconds: 900,
  riskMultiplier: 1,
  effectiveRiskMultiplier: 1.25,
  pointsCapped: false,
  routeWaypoints: [],
  events: [],
  ...over,
})

describe('TripSummaryView', () => {
  it('shows the score and the points a scored trip earned', () => {
    render(<TripSummaryView summary={summary()} />)
    expect(screen.getByText(he.trip.finalScore)).toBeOnTheScreen()
    expect(screen.getByText('+42')).toBeOnTheScreen()
  })

  // A trip the server never answered for shows no gauge and no zero: a 0 here told
  // the driver they drove badly when the app had simply never reached the server.
  it('withholds every server-owned number until the trip is scored', () => {
    render(<TripSummaryView summary={summary({ state: 'pending' })} />)
    expect(screen.queryByText(he.trip.finalScore)).toBeNull()
    expect(screen.getByText(he.trip.notSent)).toBeOnTheScreen()
    expect(screen.getAllByText('--')).toHaveLength(1)
  })

  // Same withheld numbers, opposite promise: this one is not on its way (CAR-312).
  it('tells a driver a given-up trip will not be sent, not that it will', () => {
    render(<TripSummaryView summary={summary({ state: 'failed' })} />)
    expect(screen.queryByText(he.trip.finalScore)).toBeNull()
    expect(screen.getByText(he.trip.notSentFailed)).toBeOnTheScreen()
    expect(screen.queryByText(he.trip.notSent)).toBeNull()
    expect(screen.getAllByText('--')).toHaveLength(2)
  })

  it('explains a trip too short to have been recorded', () => {
    render(<TripSummaryView summary={TOO_SHORT_SUMMARY} />)
    expect(screen.getByText(he.trip.noTripDetected)).toBeOnTheScreen()
    expect(screen.queryByText(he.trip.finalScore)).toBeNull()
  })

  it('renders a trip that covered no distance', () => {
    render(<TripSummaryView summary={summary({ distanceKm: 0, durationSeconds: 0, points: 0 })} />)
    expect(screen.getByText(he.trip.finalScore)).toBeOnTheScreen()
  })

  // CAR-192: the raw multiplier told a driver what happened and never what to do about
  // it. What replaced it is what a score of 100 would be worth, on the night trips where
  // that is true at all.
  it('says nothing about a night bonus on a daytime trip', () => {
    render(<TripSummaryView summary={summary({ riskMultiplier: 1, effectiveRiskMultiplier: 1 })} />)
    expect(screen.queryByText(he.trip.nightBonusHalf)).toBeNull()
    expect(screen.queryByText(he.trip.nightBonusDouble)).toBeNull()
    expect(screen.queryByText(he.trip.nightBonusFull)).toBeNull()
  })

  // The gate is the base multiplier, not the effective one: at or below the taper floor
  // a night trip's effective is exactly 1, and that is the trip the line matters most on.
  it('states what a full score is worth on a night trip that earned none of it', () => {
    render(<TripSummaryView summary={summary({ score: 65, riskMultiplier: 1.5, effectiveRiskMultiplier: 1 })} />)
    expect(screen.getByText(he.trip.nightBonusHalf)).toBeOnTheScreen()
  })

  it('separates a weekend night from a weekday one', () => {
    render(<TripSummaryView summary={summary({ score: 85, riskMultiplier: 2 })} />)
    expect(screen.getByText(he.trip.nightBonusDouble)).toBeOnTheScreen()
  })

  it('congratulates a trip that earned the whole bonus', () => {
    render(<TripSummaryView summary={summary({ score: 100, riskMultiplier: 2 })} />)
    expect(screen.getByText(he.trip.nightBonusFull)).toBeOnTheScreen()
    expect(screen.queryByText(he.trip.nightBonusDouble)).toBeNull()
  })

  it('holds the night line back until the trip has a score', () => {
    render(<TripSummaryView summary={summary({ state: 'pending', riskMultiplier: 2 })} />)
    expect(screen.queryByText(he.trip.nightBonusDouble)).toBeNull()
  })

  it('warns when the points were capped', () => {
    render(<TripSummaryView summary={summary({ pointsCapped: true })} />)
    expect(screen.getByText(he.trip.pointsCapped)).toBeOnTheScreen()
  })
})
