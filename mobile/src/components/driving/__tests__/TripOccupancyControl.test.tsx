import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { TripOccupancyControl } from '@/components/driving/TripOccupancyControl'
import { tripsApi } from '@/services/api/trips.api'
import he from '@/i18n/he'

jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))
jest.mock('@/services/api/trips.api', () => ({
  tripsApi: { occupancy: jest.fn(), declareOccupancy: jest.fn() },
}))

const occupancy = tripsApi.occupancy as jest.Mock
const declareOccupancy = tripsApi.declareOccupancy as jest.Mock

const answer = (over = {}) => ({ tripId: 't1', verdict: 'UNKNOWN', excludedFromDriverScore: false, ...over })

beforeEach(() => {
  occupancy.mockReset().mockResolvedValue(answer())
  declareOccupancy.mockReset().mockResolvedValue(answer({ verdict: 'PASSENGER', excludedFromDriverScore: true }))
})

describe('TripOccupancyControl', () => {
  it('offers the declaration on a trip nobody has said anything about', async () => {
    render(<TripOccupancyControl tripId="t1" />)
    expect(await screen.findByText(he.trip.occupancyPassengerCta)).toBeOnTheScreen()
    // The wording that keeps this from being read as a delete button is part of the control.
    expect(screen.getByText(he.trip.occupancyExplainer)).toBeOnTheScreen()
  })

  it('declares unprompted — nothing in the app raises a prompt yet', async () => {
    render(<TripOccupancyControl tripId="t1" />)
    fireEvent.press(await screen.findByText(he.trip.occupancyPassengerCta))
    await waitFor(() => expect(declareOccupancy).toHaveBeenCalledWith('t1', false, false))
  })

  it('states the trip is out of the score only because the server said so', async () => {
    occupancy.mockResolvedValue(answer({ verdict: 'PASSENGER', excludedFromDriverScore: true }))
    render(<TripOccupancyControl tripId="t1" />)
    expect(await screen.findByText(he.trip.occupancyDeclared)).toBeOnTheScreen()
    expect(screen.queryByText(he.trip.occupancyPassengerCta)).toBeNull()
  })

  // The exclusion is the server's call. A declaration it did not act on must not be
  // reported to the driver as one that removed the trip from their score.
  it('withholds that sentence when the server did not exclude the trip', async () => {
    occupancy.mockResolvedValue(answer({ verdict: 'PASSENGER', excludedFromDriverScore: false }))
    render(<TripOccupancyControl tripId="t1" />)
    expect(await screen.findByText(he.trip.occupancyUndo)).toBeOnTheScreen()
    expect(screen.queryByText(he.trip.occupancyDeclared)).toBeNull()
  })

  it('takes the declaration back', async () => {
    occupancy.mockResolvedValue(answer({ verdict: 'PASSENGER', excludedFromDriverScore: true }))
    declareOccupancy.mockResolvedValue(answer({ verdict: 'DRIVER' }))
    render(<TripOccupancyControl tripId="t1" />)
    fireEvent.press(await screen.findByText(he.trip.occupancyUndo))
    await waitFor(() => expect(declareOccupancy).toHaveBeenCalledWith('t1', true, false))
    expect(await screen.findByText(he.trip.occupancyPassengerCta)).toBeOnTheScreen()
  })

  // Hiding the control on a failed read would cost the label this phase exists to
  // collect; declaring twice is the same write, so offering it again costs nothing.
  it('still offers the declaration when the verdict could not be read', async () => {
    occupancy.mockRejectedValue(new Error('offline'))
    render(<TripOccupancyControl tripId="t1" />)
    expect(await screen.findByText(he.trip.occupancyFailed)).toBeOnTheScreen()
    expect(screen.getByText(he.trip.occupancyPassengerCta)).toBeOnTheScreen()
  })
})
