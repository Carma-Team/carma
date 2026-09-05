import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { RecentTripsSection } from '@/components/dashboard/RecentTripsSection'
import he from '@/i18n/he'
import type { Trip } from '@/types'

// The real context pulls in the driving SDK; the section reads the language and the
// one action it can take.
const mockDeleteTrips = jest.fn()
jest.mock('@/context/AppContext', () => ({
  useApp: () => ({ lang: 'HE', deleteTrips: mockDeleteTrips }),
}))

// Stubbed rather than rendered: TripList's own slicing is already covered where it
// lives, and rendering real cards would drag in the router and trip formatting for a
// test about how many rows this section asks for.
jest.mock('@/components/driving/TripList', () => {
  const { Text, TouchableOpacity } = jest.requireActual('react-native')
  return {
    TripList: ({ trips, maxItems, selectable, selectedIds, onToggleSelect }: {
      trips: { id: string }[]; maxItems?: number
      selectable?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void
    }) => (
      <>
        <Text testID="trip-list">{`${Math.min(maxItems ?? trips.length, trips.length)}/${trips.length}`}</Text>
        <Text testID="trip-list-mode">{selectable ? 'select' : 'browse'}</Text>
        <Text testID="trip-list-selected">{[...(selectedIds ?? [])].join(',')}</Text>
        {trips.slice(0, maxItems ?? trips.length).map(trip => (
          <TouchableOpacity key={trip.id} testID={`row-${trip.id}`} onPress={() => onToggleSelect?.(trip.id)}>
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
  const enterSelection = () => fireEvent.press(screen.getByLabelText(he.dashboard.deleteTrips))
  const selected = () => screen.getByTestId('trip-list-selected').props.children
  const mode = () => screen.getByTestId('trip-list-mode').props.children

  // Spied rather than module-mocked: replacing the Alert module leaves the `Alert`
  // re-exported by react-native undefined, so the component's own call blows up.
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})

  /** Presses Confirm on the alert the component raised. */
  const confirmAlert = async () => {
    const buttons = alertSpy.mock.calls.at(-1)![2]!
    await act(async () => {
      await buttons.find(b => b.style === 'destructive')!.onPress!()
    })
  }

  beforeEach(() => jest.clearAllMocks())

  it('browses until the driver asks to delete', () => {
    render(<RecentTripsSection trips={trips(3)} />)
    expect(mode()).toBe('browse')

    enterSelection()
    expect(mode()).toBe('select')
  })

  it('deletes exactly the trips that were ticked', async () => {
    render(<RecentTripsSection trips={trips(4)} />)
    enterSelection()

    fireEvent.press(screen.getByTestId('row-t0'))
    fireEvent.press(screen.getByTestId('row-t2'))
    expect(selected()).toBe('t0,t2')

    fireEvent.press(screen.getAllByText(he.dashboard.deleteTrips)[0])
    await confirmAlert()

    expect(mockDeleteTrips).toHaveBeenCalledWith(['t0', 't2'])
  })

  it('un-ticks a trip pressed twice', () => {
    render(<RecentTripsSection trips={trips(3)} />)
    enterSelection()

    fireEvent.press(screen.getByTestId('row-t1'))
    fireEvent.press(screen.getByTestId('row-t1'))

    expect(selected()).toBe('')
  })

  it('selects only what is on screen, never the trips still folded away', () => {
    // 12 trips, a batch of 5: select-all must not promise to delete the other 7.
    render(<RecentTripsSection trips={trips(12)} />)
    enterSelection()

    fireEvent.press(screen.getByText(he.dashboard.selectAll))

    expect(selected()).toBe('t0,t1,t2,t3,t4')
  })

  it('drops the selection on leaving the mode', () => {
    render(<RecentTripsSection trips={trips(3)} />)
    enterSelection()
    fireEvent.press(screen.getByTestId('row-t0'))

    enterSelection() // the same control closes it
    expect(mode()).toBe('browse')

    enterSelection()
    expect(selected()).toBe('')
  })

  it('offers no delete control for an empty history', () => {
    render(<RecentTripsSection trips={[]} />)
    expect(screen.queryByLabelText(he.dashboard.deleteTrips)).toBeNull()
  })
})
