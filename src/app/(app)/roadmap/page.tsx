'use client'

import React from 'react'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { RoadmapView } from '@/components/gamification/RoadmapView'

export default function RoadmapPage() {
  const { user } = useApp()
  const { t } = useT()

  if (!user) return null

  return (
    <div className="pt-6 pb-4 page-enter">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">{t('roadmap.title')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('roadmap.subtitle')}</p>
      </div>

      <RoadmapView currentLevel={user.level} totalPoints={user.totalPoints} />
    </div>
  )
}
