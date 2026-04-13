'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'
import { ScoreReveal } from '@/components/driving/ScoreReveal'
import type { Trip } from '@/types'

export default function TripSummaryPage({ params }: { params: { id: string } }) {
  const { t } = useT()
  const router = useRouter()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/trips/${params.id}`)
      .then(res => res.json())
      .then(data => setTrip(data.trip))
      .catch(() => router.push('/dashboard'))
      .finally(() => setLoading(false))
  }, [params.id, router])

  if (loading) {
    return (
      <div className="pt-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-center text-slate-400">
          <div className="text-3xl animate-spin mb-2">⚙️</div>
          <p>{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (!trip) return null

  return (
    <div className="pt-6 pb-4 page-enter">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-black text-white">{t('trip.summary')}</h1>
        <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm">
          {t('common.back')}
        </button>
      </div>

      <ScoreReveal trip={trip} />

      <div className="mt-8 space-y-3">
        <Button fullWidth size="lg" onClick={() => router.push('/trip/active')}>
          🚗 {t('trip.start')}
        </Button>
        <Button fullWidth variant="secondary" onClick={() => router.push('/dashboard')}>
          {t('nav.dashboard')}
        </Button>
      </div>
    </div>
  )
}
