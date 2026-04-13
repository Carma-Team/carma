'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/hooks/useTranslation'
import { useTrip } from '@/hooks/useTrip'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ActiveTripMonitor } from '@/components/driving/ActiveTripMonitor'

export default function ActiveTripPage() {
  const { t } = useT()
  const { addToast } = useApp()
  const router = useRouter()
  const { state, startTrip, endTrip } = useTrip()
  const [loading, setLoading] = useState(false)

  async function handleStart() {
    setLoading(true)
    try {
      await startTrip()
      addToast({ type: 'success', message: '🚗 הנסיעה התחילה!' })
    } catch {
      addToast({ type: 'error', message: t('common.error') })
    } finally {
      setLoading(false)
    }
  }

  async function handleEnd() {
    setLoading(true)
    try {
      const result = await endTrip()
      addToast({ type: 'success', message: `✅ הנסיעה הסתיימה! +${Math.round(result.trip.points)} נקודות` })
      router.push(`/trip/${result.trip.id}`)
    } catch {
      addToast({ type: 'error', message: t('common.error') })
      setLoading(false)
    }
  }

  if (!state.isActive) {
    return (
      <div className="pt-6 pb-4 page-enter">
        <h1 className="text-2xl font-black text-white mb-6">{t('trip.active')}</h1>

        <Card glass className="text-center py-12 mb-6">
          <div className="text-6xl mb-4">🚗</div>
          <h2 className="text-xl font-bold text-white mb-2">{t('trip.start')}</h2>
          <p className="text-slate-400 text-sm mb-6">{t('trip.simulationNote')}</p>
          <Button size="xl" onClick={handleStart} loading={loading}>
            {t('trip.start')}
          </Button>
        </Card>

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { emoji: '⚡', title: t('trip.hardBrakes'),    desc: 'x5 עונש' },
            { emoji: '🚀', title: t('trip.aggressiveAccels'), desc: 'x3 עונש' },
            { emoji: '↩️', title: t('trip.sharpTurns'),    desc: 'x2 עונש' },
            { emoji: '📱', title: t('trip.phoneTouches'),  desc: 'x40 עונש' },
          ].map(item => (
            <Card key={item.emoji} padding="sm" className="text-center opacity-60">
              <div className="text-2xl mb-1">{item.emoji}</div>
              <p className="text-xs text-white font-medium">{item.title}</p>
              <p className="text-xs text-red-400">{item.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="pt-6 pb-4 page-enter">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-black text-white">{t('trip.active')}</h1>
        <span className="flex items-center gap-2 text-green-400 text-sm font-semibold">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          LIVE
        </span>
      </div>

      <ActiveTripMonitor
        durationSeconds={state.durationSeconds}
        distanceKm={state.distanceKm}
        eventCounts={state.eventCounts}
        phoneSeconds={state.phoneSeconds}
      />

      <div className="mt-6">
        <Button
          variant="danger"
          fullWidth
          size="xl"
          onClick={handleEnd}
          loading={loading}
        >
          🏁 {t('trip.end')}
        </Button>
      </div>
    </div>
  )
}
