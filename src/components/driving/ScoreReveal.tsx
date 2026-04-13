'use client'

import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useTranslation'
import { scoreToColor, scoreToGrade } from '@/lib/scoring'
import { formatDistance, formatDuration, formatPoints } from '@/lib/utils'
import type { ScoringResult, Trip } from '@/types'

interface ScoreRevealProps {
  trip: Trip
  scoring?: ScoringResult
  onDone?: () => void
}

export function ScoreReveal({ trip, scoring, onDone }: ScoreRevealProps) {
  const { t, lang } = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const grade = scoreToGrade(trip.score)
  const color = scoreToColor(trip.score)

  const gradeLabel = {
    excellent: t('trip.status.excellent'),
    good:      t('trip.status.good'),
    fair:      t('trip.status.fair'),
    poor:      t('trip.status.poor'),
  }[grade]

  const gradeEmoji = {
    excellent: '🌟',
    good:      '😊',
    fair:      '😐',
    poor:      '😟',
  }[grade]

  return (
    <div className="text-center space-y-6">
      {/* Score circle */}
      <div
        className="relative mx-auto w-40 h-40 rounded-full flex items-center justify-center"
        style={{
          background: `conic-gradient(${color} ${trip.score}%, #1e293b ${trip.score}%)`,
          transition: 'all 1s ease-out',
        }}
      >
        <div
          className="w-32 h-32 rounded-full bg-carma-dark flex flex-col items-center justify-center"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'scale(1)' : 'scale(0.5)', transition: 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
        >
          <span className="text-3xl">{gradeEmoji}</span>
          <span className="text-3xl font-black text-white" style={{ color }}>{Math.round(trip.score)}</span>
          <span className="text-xs text-slate-400">{gradeLabel}</span>
        </div>
      </div>

      {/* Points earned */}
      <div
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)', transition: 'all 0.6s ease 0.3s' }}
      >
        <p className="text-sm text-slate-400">{t('trip.pointsEarned')}</p>
        <p className="text-4xl font-black text-brand-400">+{Math.round(trip.points)}</p>
        {trip.riskMultiplier > 1 && (
          <p className="text-sm text-amber-400 mt-1">🌙 {t('trip.riskHourBonus')} x{trip.riskMultiplier}</p>
        )}
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-3 gap-3"
        style={{ opacity: visible ? 1 : 0, transition: 'all 0.6s ease 0.5s' }}
      >
        {[
          { label: t('trip.duration'), value: formatDuration(trip.durationSeconds, lang) },
          { label: t('trip.distance'), value: formatDistance(trip.distanceKm, lang) },
          { label: t('trip.events'),   value: String(trip.hardBrakes + trip.aggressiveAccels + trip.sharpTurns + trip.phoneSeconds) },
        ].map(stat => (
          <div key={stat.label} className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-white font-bold">{stat.value}</p>
            <p className="text-xs text-slate-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* AI Insight */}
      {trip.aiInsight && (
        <div
          className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 text-start"
          style={{ opacity: visible ? 1 : 0, transition: 'all 0.6s ease 0.7s' }}
        >
          <p className="text-xs text-brand-400 font-semibold mb-1">💡 {t('trip.aiInsight')}</p>
          <p className="text-sm text-slate-200">{trip.aiInsight}</p>
        </div>
      )}
    </div>
  )
}

export default ScoreReveal
