'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatDistance, formatDuration, scoreToEmoji } from '@/lib/utils'
import { scoreToGrade } from '@/lib/scoring'
import type { Trip } from '@/types'

interface TripCardProps {
  trip: Trip
  onClick?: () => void
}

export function TripCard({ trip, onClick }: TripCardProps) {
  const { t, lang } = useT()
  const grade = scoreToGrade(trip.score)
  const gradeVariant = {
    excellent: 'success',
    good: 'success',
    fair: 'warning',
    poor: 'danger',
  }[grade] as 'success' | 'warning' | 'danger'

  return (
    <Card
      className="cursor-pointer hover:border-brand-500/40 transition-colors active:scale-[0.99]"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-2xl">{scoreToEmoji(trip.score)}</div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm">
              {trip.startLocation && trip.endLocation
                ? `${trip.startLocation} → ${trip.endLocation}`
                : formatDate(trip.startTime, lang)}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">
              {formatDate(trip.startTime, lang)} · {formatDuration(trip.durationSeconds, lang)} · {formatDistance(trip.distanceKm, lang)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant={gradeVariant}>
            {Math.round(trip.score)}
          </Badge>
          <span className="text-xs text-brand-400 font-medium">
            +{Math.round(trip.points)} {t('common.points')}
          </span>
        </div>
      </div>

      {/* Quick event summary */}
      {(trip.hardBrakes > 0 || trip.phoneSeconds > 10) && (
        <div className="flex gap-3 mt-3 pt-3 border-t border-carma-border text-xs text-slate-400">
          {trip.hardBrakes > 0 && (
            <span>⚡ {trip.hardBrakes} {t('trip.hardBrakes')}</span>
          )}
          {trip.phoneSeconds > 10 && (
            <span>📱 {trip.phoneSeconds}s</span>
          )}
          {trip.riskMultiplier > 1 && (
            <span className="text-amber-400">🌙 x{trip.riskMultiplier}</span>
          )}
        </div>
      )}
    </Card>
  )
}

export default TripCard
