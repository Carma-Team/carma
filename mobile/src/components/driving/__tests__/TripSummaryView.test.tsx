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
    expect(screen.getByText('x1.25')).toBeOnTheScreen()
  })

  // A trip the server never answered for shows no gauge and no zero: a 0 here told
  // the driver they drove badly when the app had simply never reached the server.
  it('withholds every server-owned number until the trip is scored', () => {
    render(<TripSummaryView summary={summary({ state: 'pending' })} />)
    expect(screen.queryByText(he.trip.finalScore)).toBeNull()
    expect(screen.getByText(he.trip.notSent)).toBeOnTheScreen()
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

  it('warns when the points were capped', () => {
    render(<TripSummaryView summary={summary({ pointsCapped: true })} />)
    expect(screen.getByText(he.trip.pointsCapped)).toBeOnTheScreen()
  })
})
