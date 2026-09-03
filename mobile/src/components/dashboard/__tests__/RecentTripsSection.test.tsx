import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { RecentTripsSection } from '@/components/dashboard/RecentTripsSection'
import he from '@/i18n/he'
import type { Trip } from '@/types'

// The real context pulls in the driving SDK; the section only ever reads the language.
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))

// Stubbed rather than rendered: TripList's own slicing is already covered where it
// lives, and rendering real cards would drag in the router and trip formatting for a
// test about how many rows this section asks for.
jest.mock('@/components/driving/TripList', () => {
  const { Text } = jest.requireActual('react-native')
  return {
    TripList: ({ trips, maxItems }: { trips: unknown[]; maxItems?: number }) => (
      <Text testID="trip-list">{`${Math.min(maxItems ?? trips.length, trips.length)}/${trips.length}`}</Text>
    ),
  }
})

const trips = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }) as Trip)

const shown = () => screen.getByTestId('trip-list').props.children
const moreButton = () => screen.queryByText(he.dashboard.showMore)

describe('RecentTripsSection batching', () => {
  it('shows at most the first batch on entry', () => {
    render(<RecentTripsSection trips={trips(12)} />)
    expect(shown()).toBe('5/12')
  })

  it('offers more only while trips remain', () => {
    render(<RecentTripsSection trips={trips(5)} />)
    expect(moreButton()).toBeNull()
  })

  it('appends a batch on each press and stops at the end of the history', () => {
    render(<RecentTripsSection trips={trips(12)} />)

    fireEvent.press(moreButton()!)
    expect(shown()).toBe('10/12')

    // The last press lands on a partial batch — the button has to go once the list
    // is exhausted, not once a press has been made.
    fireEvent.press(moreButton()!)
    expect(shown()).toBe('12/12')
    expect(moreButton()).toBeNull()
  })

  it('offers nothing to expand for an empty history', () => {
    render(<RecentTripsSection trips={[]} />)
    expect(moreButton()).toBeNull()
  })
})
