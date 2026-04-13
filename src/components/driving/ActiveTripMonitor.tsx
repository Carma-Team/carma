'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { formatDuration, formatDistance } from '@/lib/utils'
import type { TripEventType } from '@/types'

interface EventCounts {
  HARD_BRAKE: number
  AGGRESSIVE_ACCEL: number
  SHARP_TURN: number
  PHONE_TOUCH: number
}

interface ActiveTripMonitorProps {
  durationSeconds: number
  distanceKm: number
  eventCounts: EventCounts
  phoneSeconds: number
}

function getTrafficLightColor(counts: EventCounts, phoneSeconds: number): 'green' | 'yellow' | 'red' {
  const total = counts.HARD_BRAKE * 5 + counts.AGGRESSIVE_ACCEL * 3 + counts.SHARP_TURN * 2 + (phoneSeconds > 30 ? 3 : 0)
  if (total === 0) return 'green'
  if (total <= 5) return 'yellow'
  return 'red'
}

export function ActiveTripMonitor({
  durationSeconds,
  distanceKm,
  eventCounts,
  phoneSeconds,
}: ActiveTripMonitorProps) {
  const { t, lang } = useT()
  const light = getTrafficLightColor(eventCounts, phoneSeconds)

  const lightColors = {
    green:  { bg: 'bg-green-500', glow: 'shadow-green-500/60', text: t('trip.trafficLight.green') },
    yellow: { bg: 'bg-amber-400', glow: 'shadow-amber-400/60', text: t('trip.trafficLight.yellow') },
    red:    { bg: 'bg-red-500',   glow: 'shadow-red-500/60',   text: t('trip.trafficLight.red') },
  }

  const current = lightColors[light]

  const events = [
    { key: 'HARD_BRAKE',       label: t('trip.hardBrakes'),    emoji: '⚡', count: eventCounts.HARD_BRAKE },
    { key: 'AGGRESSIVE_ACCEL', label: t('trip.aggressiveAccels'), emoji: '🚀', count: eventCounts.AGGRESSIVE_ACCEL },
    { key: 'SHARP_TURN',       label: t('trip.sharpTurns'),    emoji: '↩️', count: eventCounts.SHARP_TURN },
    { key: 'PHONE_TOUCH',      label: t('trip.phoneTouches'),  emoji: '📱', count: eventCounts.PHONE_TOUCH },
  ]

  return (
    <div className="space-y-4">
      {/* Traffic light indicator */}
      <Card glass className="text-center py-6">
        <div className="flex justify-center mb-4">
          <div className={`w-24 h-24 rounded-full ${current.bg} shadow-2xl ${current.glow} flex items-center justify-center animate-pulse-slow`}>
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-3xl">
                {light === 'green' ? '😊' : light === 'yellow' ? '😐' : '😟'}
              </span>
            </div>
          </div>
        </div>
        <p className="text-white font-bold text-lg">{current.text}</p>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <Card glass padding="sm" className="text-center">
          <p className="text-2xl font-bold text-white">{formatDuration(durationSeconds, lang)}</p>
          <p className="text-xs text-slate-400 mt-1">{t('trip.duration')}</p>
        </Card>
        <Card glass padding="sm" className="text-center">
          <p className="text-2xl font-bold text-white">{formatDistance(distanceKm, lang)}</p>
          <p className="text-xs text-slate-400 mt-1">{t('trip.distance')}</p>
        </Card>
      </div>

      {/* Event counters */}
      <Card glass padding="sm">
        <div className="grid grid-cols-2 gap-2">
          {events.map(ev => (
            <div key={ev.key} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5">
              <span className="text-sm text-slate-300">{ev.emoji} {ev.label}</span>
              <span className={`font-bold text-sm ${ev.count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {ev.count}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default ActiveTripMonitor
