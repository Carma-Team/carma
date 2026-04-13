'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { LevelBadge } from '@/components/gamification/LevelBadge'
import { TripCard } from '@/components/driving/TripCard'
import { getLevelConfig, getLevelProgress, getPointsToNextLevel } from '@/lib/constants'
import { formatDistance, formatDuration } from '@/lib/utils'
import { scoreToColor } from '@/lib/scoring'
import type { Trip } from '@/types'

export default function DashboardPage() {
  const { user } = useApp()
  const { t, lang } = useT()
  const router = useRouter()
  const [recentTrips, setRecentTrips] = useState<Trip[]>([])
  const [avgScore, setAvgScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/trips?limit=3')
        if (res.ok) {
          const data = await res.json()
          setRecentTrips(data.trips)
          if (data.trips.length > 0) {
            const avg = data.trips.reduce((s: number, t: Trip) => s + t.score, 0) / data.trips.length
            setAvgScore(Math.round(avg))
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (!user) return null

  const levelConfig = getLevelConfig(user.level)
  const levelProgress = getLevelProgress(user.totalPoints, user.level)
  const pointsToNext = getPointsToNextLevel(user.totalPoints, user.level)

  return (
    <div className="pt-6 pb-4 space-y-4 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-sm">{t('dashboard.welcome')},</p>
          <h1 className="text-2xl font-black text-white">{user.name.split(' ')[0]} 👋</h1>
        </div>
        <Link href="/notifications">
          <div className="relative">
            <div className="w-10 h-10 bg-carma-card border border-carma-border rounded-xl flex items-center justify-center text-xl">🔔</div>
            {(user as any).unreadNotifications > 0 && (
              <span className="absolute -top-1 -end-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                {Math.min((user as any).unreadNotifications, 9)}
              </span>
            )}
          </div>
        </Link>
      </div>

      {/* Score + Level hero */}
      <Card glass glow className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-500/10 to-teal-500/5 pointer-events-none" />
        <div className="flex items-center gap-4 relative">
          <LevelBadge level={user.level} size="lg" lang={lang} showName />
          <div className="flex-1">
            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="text-5xl font-black"
                style={{ color: avgScore !== null ? scoreToColor(avgScore) : '#22c55e' }}
              >
                {avgScore ?? '--'}
              </span>
              <span className="text-slate-400 text-sm">{t('dashboard.yourScore')}</span>
            </div>
            <Progress value={levelProgress} color={levelConfig.color} />
            <p className="text-xs text-slate-400 mt-1">
              {user.totalPoints.toLocaleString()} {t('common.points')}
              {pointsToNext > 0 && ` · ${t('dashboard.pointsToNextLevel')}: ${pointsToNext}`}
            </p>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('dashboard.totalTrips'), value: recentTrips.length > 0 ? '...' : '0', emoji: '🚗' },
          { label: t('dashboard.totalDistance'), value: formatDistance(user.totalDistance, lang), emoji: '📍' },
          { label: t('common.points'), value: user.totalPoints.toLocaleString(), emoji: '⭐' },
        ].map(stat => (
          <Card key={stat.label} padding="sm" className="text-center">
            <div className="text-xl mb-1">{stat.emoji}</div>
            <p className="text-white font-bold text-sm">{stat.value}</p>
            <p className="text-slate-500 text-xs">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Start trip CTA */}
      <Link href="/trip/active">
        <Button fullWidth size="xl" className="relative overflow-hidden">
          <span className="text-xl me-2">🚗</span>
          {t('dashboard.startTrip')}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 pointer-events-none" />
        </Button>
      </Link>

      {/* Recent trips */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-white">{t('dashboard.recentTrips')}</h2>
          <Link href="/profile" className="text-brand-400 text-sm">{t('dashboard.viewAll')}</Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-carma-card rounded-2xl border border-carma-border animate-pulse" />
            ))}
          </div>
        ) : recentTrips.length === 0 ? (
          <Card className="text-center py-8">
            <div className="text-4xl mb-2">🛣️</div>
            <p className="text-slate-400">{t('dashboard.noTrips')}</p>
            <p className="text-slate-500 text-sm mt-1">{t('dashboard.noTripsDesc')}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentTrips.map(trip => (
              <TripCard
                key={trip.id}
                trip={trip}
                onClick={() => router.push(`/trip/${trip.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
