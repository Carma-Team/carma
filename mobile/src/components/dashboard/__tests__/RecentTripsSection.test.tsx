import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { RecentTripsSection } from '@/components/dashboard/RecentTripsSection'
import he from '@/i18n/he'
import type { Trip } from '@/types'

// The real context pulls in the driving SDK; the section reads the language and the
// one action it can take.
const mockClearTripHistory = jest.fn()
jest.mock('@/context/AppContext', () => ({
  useApp: () => ({ lang: 'HE', clearTripHistory: mockClearTripHistory }),
}))

// Stubbed rather than rendered: TripList's own slicing is already covered where it
// lives, and rendering real cards would drag in the router and trip formatting for a
// test about how many rows this section asks for.
jest.mock('@/components/driving/TripList', () => {
  const { Text, TouchableOpacity } = jest.requireActual('react-native')
  return {
    TripList: ({ trips, maxItems }: { trips: { id: string }[]; maxItems?: number }) => (
      <>
        <Text testID="trip-list">{`${Math.min(maxItems ?? trips.length, trips.length)}/${trips.length}`}</Text>
        {trips.slice(0, maxItems ?? trips.length).map(trip => (
          <TouchableOpacity key={trip.id} testID={`row-${trip.id}`}>
            <Text>{trip.id}</Text>
          </TouchableOpacity>
        ))}
      </>
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

describe('RecentTripsSection deletion', () => {
  const trashButton = () => screen.queryByLabelText(he.dashboard.deleteAllTrips)

  // Spied rather than module-mocked: replacing the Alert module leaves the `Alert`
  // re-exported by react-native undefined, so the component's own call blows up.
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})

  /** Presses one of the buttons on the alert the component raised. */
  const pressAlert = async (style: 'cancel' | 'destructive') => {
    const buttons = alertSpy.mock.calls.at(-1)![2]!
    await act(async () => {
      await buttons.find(b => b.style === style)!.onPress?.()
    })
  }

  beforeEach(() => jest.clearAllMocks())

  it('asks before it clears anything', () => {
    render(<RecentTripsSection trips={trips(3)} />)

    fireEvent.press(trashButton()!)
    expect(alertSpy).toHaveBeenCalled()
    expect(mockClearTripHistory).not.toHaveBeenCalled()
  })

  it('clears the whole history once the driver confirms', async () => {
    render(<RecentTripsSection trips={trips(4)} />)

    fireEvent.press(trashButton()!)
    await pressAlert('destructive')

    expect(mockClearTripHistory).toHaveBeenCalledTimes(1)
  })

  it('leaves the history alone on cancel', async () => {
    render(<RecentTripsSection trips={trips(4)} />)

    fireEvent.press(trashButton()!)
    await pressAlert('cancel')

    expect(mockClearTripHistory).not.toHaveBeenCalled()
  })

  it('offers no delete control for an empty history', () => {
    render(<RecentTripsSection trips={[]} />)
    expect(trashButton()).toBeNull()
  })
})
