'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const STEPS = [
  {
    titleKey: 'onboarding.step1Title',
    descKey:  'onboarding.step1Desc',
    icon:     '📡',
    actionKey: 'onboarding.connectBluetooth',
  },
  {
    titleKey: 'onboarding.step2Title',
    descKey:  'onboarding.step2Desc',
    icon:     '📍',
    actionKey: 'onboarding.enableLocation',
  },
  {
    titleKey: 'onboarding.step3Title',
    descKey:  'onboarding.step3Desc',
    icon:     '🚀',
    actionKey: 'onboarding.startDriving',
  },
]

export default function OnboardingPage() {
  const { t } = useT()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [done, setDone] = useState<boolean[]>([false, false, false])

  const current = STEPS[step]

  function handleAction() {
    const next = [...done]
    next[step] = true
    setDone(next)

    if (step < STEPS.length - 1) {
      setTimeout(() => setStep(s => s + 1), 400)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-carma-dark flex flex-col p-6">
      {/* Header */}
      <div className="text-center pt-8 mb-8">
        <h1 className="text-2xl font-black text-white">{t('onboarding.title')}</h1>
        <p className="text-slate-400 mt-1">{t('onboarding.subtitle')}</p>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-2 mb-8">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i <= step ? 'bg-brand-500 w-8' : 'bg-slate-700 w-4'
            }`}
          />
        ))}
      </div>

      {/* Step card */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <Card className="w-full text-center p-8">
          <div className="text-6xl mb-6">{current.icon}</div>
          <h2 className="text-xl font-bold text-white mb-3">{t(current.titleKey)}</h2>
          <p className="text-slate-400 leading-relaxed mb-8">{t(current.descKey)}</p>

          {done[step] ? (
            <div className="text-green-400 font-semibold">✅ {t('onboarding.connected')}</div>
          ) : (
            <Button fullWidth size="lg" onClick={handleAction}>
              {t(current.actionKey)}
            </Button>
          )}

          {/* Simulation note */}
          <div className="mt-4 p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
            <p className="text-xs text-amber-400">{t('onboarding.simulateMode')}</p>
          </div>
        </Card>

        {step < STEPS.length - 1 && (
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-4 text-slate-500 text-sm hover:text-slate-300"
          >
            {t('onboarding.skip')} →
          </button>
        )}
      </div>
    </div>
  )
}
