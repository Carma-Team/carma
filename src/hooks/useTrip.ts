'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { EVENT_PROBABILITIES, TRIP_SIMULATION_INTERVAL_MS, TRIP_SPEED_KM_PER_MIN } from '@/lib/constants'
import { getRiskMultiplier } from '@/lib/scoring'
import type { TripEvent, TripEventType } from '@/types'

export interface TripState {
  tripId: string | null
  isActive: boolean
  startTime: Date | null
  durationSeconds: number
  distanceKm: number
  events: TripEvent[]
  eventCounts: {
    HARD_BRAKE: number
    AGGRESSIVE_ACCEL: number
    SHARP_TURN: number
    PHONE_TOUCH: number
  }
  phoneSeconds: number
  riskMultiplier: number
}

const INITIAL_STATE: TripState = {
  tripId: null,
  isActive: false,
  startTime: null,
  durationSeconds: 0,
  distanceKm: 0,
  events: [],
  eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, PHONE_TOUCH: 0 },
  phoneSeconds: 0,
  riskMultiplier: 1.0,
}

export function useTrip() {
  const [state, setState] = useState<TripState>(INITIAL_STATE)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const phoneTimerRef = useRef<number>(0)

  function generateRandomEvent(): TripEventType | null {
    const rand = Math.random()
    let cumulative = 0

    const events: [TripEventType, number][] = [
      ['HARD_BRAKE',       EVENT_PROBABILITIES.HARD_BRAKE],
      ['AGGRESSIVE_ACCEL', EVENT_PROBABILITIES.AGGRESSIVE_ACCEL],
      ['SHARP_TURN',       EVENT_PROBABILITIES.SHARP_TURN],
      ['PHONE_TOUCH',      EVENT_PROBABILITIES.PHONE_TOUCH],
    ]

    for (const [type, prob] of events) {
      cumulative += prob
      if (rand < cumulative) return type
    }
    return null
  }

  const startTrip = useCallback(async () => {
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (!res.ok) throw new Error('Failed to start trip')
      const data = await res.json()
      const startTime = new Date()
      const riskMultiplier = getRiskMultiplier(startTime)

      setState({
        tripId: data.trip.id,
        isActive: true,
        startTime,
        durationSeconds: 0,
        distanceKm: 0,
        events: [],
        eventCounts: { HARD_BRAKE: 0, AGGRESSIVE_ACCEL: 0, SHARP_TURN: 0, PHONE_TOUCH: 0 },
        phoneSeconds: 0,
        riskMultiplier,
      })

      return data.trip.id as string
    } catch (error) {
      console.error('Start trip error:', error)
      throw error
    }
  }, [])

  // Start simulation loops when trip becomes active
  useEffect(() => {
    if (!state.isActive) return

    // Seconds counter + distance accumulator
    secondsRef.current = setInterval(() => {
      setState(prev => {
        if (!prev.isActive) return prev
        const distanceIncrement = TRIP_SPEED_KM_PER_MIN / 60 // per second
        return {
          ...prev,
          durationSeconds: prev.durationSeconds + 1,
          distanceKm: prev.distanceKm + distanceIncrement,
        }
      })
    }, 1000)

    // Event generator every 3 seconds
    intervalRef.current = setInterval(() => {
      setState(prev => {
        if (!prev.isActive) return prev

        const eventType = generateRandomEvent()
        if (!eventType) return prev

        const event: TripEvent = {
          eventType,
          timestamp: new Date().toISOString(),
          severity: 1.0 + Math.random() * 0.5,
        }

        const newEventCounts = { ...prev.eventCounts }
        newEventCounts[eventType]++

        const newPhoneSeconds = eventType === 'PHONE_TOUCH'
          ? prev.phoneSeconds + 15
          : prev.phoneSeconds

        return {
          ...prev,
          events: [...prev.events, event],
          eventCounts: newEventCounts,
          phoneSeconds: newPhoneSeconds,
        }
      })
    }, TRIP_SIMULATION_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (secondsRef.current) clearInterval(secondsRef.current)
    }
  }, [state.isActive])

  const endTrip = useCallback(async () => {
    if (!state.tripId) throw new Error('No active trip')

    // Stop simulation
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (secondsRef.current) clearInterval(secondsRef.current)

    const finalState = state

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'end',
          tripId: finalState.tripId,
          distanceKm: Math.round(finalState.distanceKm * 10) / 10,
          durationSeconds: finalState.durationSeconds,
          hardBrakes: finalState.eventCounts.HARD_BRAKE,
          aggressiveAccels: finalState.eventCounts.AGGRESSIVE_ACCEL,
          sharpTurns: finalState.eventCounts.SHARP_TURN,
          phoneSeconds: finalState.phoneSeconds,
          events: finalState.events,
        }),
      })

      if (!res.ok) throw new Error('Failed to end trip')
      const data = await res.json()

      setState(INITIAL_STATE)
      return data as { trip: import('@/types').Trip; scoring: import('@/types').ScoringResult }
    } catch (error) {
      console.error('End trip error:', error)
      throw error
    }
  }, [state])

  return {
    state,
    startTrip,
    endTrip,
  }
}

export default useTrip
