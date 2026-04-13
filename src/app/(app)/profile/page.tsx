'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LevelBadge } from '@/components/gamification/LevelBadge'
import { AchievementGrid } from '@/components/gamification/AchievementGrid'
import { TripCard } from '@/components/driving/TripCard'
import { ScoreChart } from '@/components/stats/ScoreChart'
import { StatCard } from '@/components/stats/StatCard'
import { getLevelConfig } from '@/lib/constants'
import { formatDistance, formatDuration, formatDate } from '@/lib/utils'
import type { DrivingStats, Trip, Achievement } from '@/types'

type Section = 'stats' | 'achievements' | 'trips' | 'settings'

export default function ProfilePage() {
  const { user, setUser, addToast } = useApp()
  const { t, lang, setLang } = useT()
  const router = useRouter()
  const [section, setSection] = useState<Section>('stats')
  const [stats, setStats] = useState<DrivingStats | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (section === 'stats' && !stats) {
      setLoading(true)
      fetch('/api/user/stats')
        .then(res => res.json())
        .then(data => setStats(data.stats))
        .finally(() => setLoading(false))
    }
    if (section === 'trips' && trips.length === 0) {
      setLoading(true)
      fetch('/api/trips?limit=20')
        .then(res => res.json())
        .then(data => setTrips(data.trips))
        .finally(() => setLoading(false))
    }
  }, [section, stats, trips.length])

  async function handleLogout() {
    await fetch('/api/auth/me', { method: 'DELETE' })
    setUser(null)
    router.push('/login')
  }

  if (!user) return null

  const levelConfig = getLevelConfig(user.level)

  const sectionTabs: { key: Section; label: string; emoji: string }[] = [
    { key: 'stats',        label: t('profile.stats'),        emoji: '📊' },
    { key: 'achievements', label: t('profile.achievements'),  emoji: '🏅' },
    { key: 'trips',        label: t('profile.tripHistory'),   emoji: '🚗' },
    { key: 'settings',     label: t('profile.settings'),      emoji: '⚙️' },
  ]

  return (
    <div className="pt-6 pb-4 page-enter">
      {/* Profile header */}
      <Card glass className="mb-4">
        <div className="flex items-center gap-4">
          <LevelBadge level={user.level} size="lg" lang={lang} />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-white">{user.name}</h1>
            <p className="text-slate-400 text-sm">{user.city}</p>
            <p className="text-xs text-brand-400 mt-1" style={{ color: levelConfig.color }}>
              {levelConfig.icon} {lang === 'he' ? levelConfig.name : levelConfig.nameEn}
            </p>
          </div>
          <div className="text-end">
            <p className="text-2xl font-black text-brand-400">{user.totalPoints.toLocaleString()}</p>
            <p className="text-xs text-slate-400">{t('common.points')}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-carma-border">
          <div className="text-center">
            <p className="text-white font-bold">{formatDistance(user.totalDistance, lang)}</p>
            <p className="text-xs text-slate-400">{t('profile.totalDistance')}</p>
          </div>
          <div className="text-center">
            <p className="text-white font-bold">{user.level}</p>
            <p className="text-xs text-slate-400">{t('profile.level')}</p>
          </div>
          <div className="text-center">
            <p className="text-white font-bold">{user.createdAt ? formatDate(user.createdAt, lang) : '—'}</p>
            <p className="text-xs text-slate-400">{t('profile.joined')}</p>
          </div>
        </div>
      </Card>

      {/* Section tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-4">
        {sectionTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setSection(tab.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              section === tab.key
                ? 'bg-brand-500 text-white'
                : 'bg-carma-card border border-carma-border text-slate-400 hover:text-white'
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* Stats section */}
      {section === 'stats' && (
        <div className="space-y-4">
          {loading || !stats ? (
            <div className="h-40 bg-carma-card rounded-2xl border border-carma-border animate-pulse" />
          ) : (
            <>
              <Card>
                <h3 className="text-sm font-bold text-white mb-3">{t('stats.scoreHistory')}</h3>
                <ScoreChart data={stats.recentScores} />
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <StatCard emoji="🚗" label={t('stats.totalTrips')} value={stats.totalTrips} />
                <StatCard emoji="📍" label={t('stats.totalDistance')} value={formatDistance(stats.totalDistance, lang)} color="#3b82f6" />
                <StatCard emoji="⭐" label={t('stats.totalPoints')} value={stats.totalPoints.toLocaleString()} color="#f59e0b" />
                <StatCard emoji="🎯" label={t('stats.avgScore')} value={stats.averageScore} color="#22c55e" />
                <StatCard emoji="✅" label={t('stats.safeTrips')} value={stats.safeTripsCount} color="#0d9488" />
                <StatCard emoji="⏱️" label={t('stats.totalDuration')} value={formatDuration(stats.totalDurationSeconds, lang)} color="#8b5cf6" />
              </div>
            </>
          )}
        </div>
      )}

      {/* Achievements section */}
      {section === 'achievements' && (
        <AchievementGrid achievements={achievements} />
      )}

      {/* Trips section */}
      {section === 'trips' && (
        <div className="space-y-3">
          {loading ? (
            [1,2,3].map(i => (
              <div key={i} className="h-20 bg-carma-card rounded-2xl border border-carma-border animate-pulse" />
            ))
          ) : trips.length === 0 ? (
            <Card className="text-center py-8">
              <p className="text-slate-400">{t('profile.noTrips')}</p>
            </Card>
          ) : (
            trips.map(trip => (
              <TripCard key={trip.id} trip={trip} onClick={() => router.push(`/trip/${trip.id}`)} />
            ))
          )}
        </div>
      )}

      {/* Settings section */}
      {section === 'settings' && (
        <div className="space-y-3">
          <Card>
            <h3 className="text-sm font-bold text-white mb-3">{t('profile.language')}</h3>
            <div className="flex gap-2">
              {(['he', 'en'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                    lang === l
                      ? 'bg-brand-500 text-white'
                      : 'bg-carma-dark border border-carma-border text-slate-400 hover:text-white'
                  }`}
                >
                  {l === 'he' ? '🇮🇱 עברית' : '🇬🇧 English'}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              {[
                { label: t('profile.phone'), value: user.phone || '—' },
                { label: t('profile.city'), value: user.city || '—' },
                { label: t('profile.age'), value: user.age ? `${user.age}` : '—' },
                { label: t('profile.licenseYear'), value: user.licenseYear ? `${user.licenseYear}` : '—' },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-slate-400">{row.label}</span>
                  <span className="text-white">{row.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Button variant="danger" fullWidth onClick={handleLogout}>
            🚪 {t('auth.logout')}
          </Button>
        </div>
      )}
    </div>
  )
}
