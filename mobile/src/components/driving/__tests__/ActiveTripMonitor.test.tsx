import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ActiveTripMonitor } from '@/components/driving/ActiveTripMonitor'
import he from '@/i18n/he'

// Replaced rather than provided: the real context constructs the driving SDK, and
// the only thing this component reads from it is the language.
jest.mock('@/context/AppContext', () => ({ useApp: () => ({ lang: 'HE' }) }))

const tripState = (over: Record<string, unknown> = {}) => ({
  durationSeconds: 0,
  distanceKm: 0,
  touchEpochs: 0,
  eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, SWERVE: 0 },
  ...over,
}) as React.ComponentProps<typeof ActiveTripMonitor>['tripState']

describe('ActiveTripMonitor', () => {
  it('shows the running duration and distance', () => {
    render(<ActiveTripMonitor tripState={tripState({ durationSeconds: 125, distanceKm: 3.4 })} onEnd={jest.fn()} />)
    // Composed from the shortened time units, so the assertion names them rather
    // than pinning a Hebrew literal that lives in the translation file.
    expect(screen.getByText(`2 ${he.time.minutesShort}`)).toBeOnTheScreen()
    expect(screen.getByText(`3.4 ${he.trip.km}`)).toBeOnTheScreen()
  })

  it('ends the trip when the driver asks', () => {
    const onEnd = jest.fn()
    render(<ActiveTripMonitor tripState={tripState()} onEnd={onEnd} />)
    fireEvent.press(screen.getByText(he.trip.endBtn))
    expect(onEnd).toHaveBeenCalled()
  })

  // The live event counts are a debugging aid, not something a driver is shown.
  it('keeps the event counts out of a driver-facing trip', () => {
    render(<ActiveTripMonitor tripState={tripState({ touchEpochs: 2 })} onEnd={jest.fn()} />)
    expect(screen.queryByText(he.trip.eventsDetected)).toBeNull()
  })

  it('shows the event counts in debug mode', () => {
    render(
      <ActiveTripMonitor
        tripState={tripState({ eventCounts: { HARD_BRAKE: 5, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, SWERVE: 0 } })}
        onEnd={jest.fn()}
        showDebug
      />
    )
    expect(screen.getByText(he.trip.hardBrakes)).toBeOnTheScreen()
    expect(screen.getByText('5')).toBeOnTheScreen()
  })
})
