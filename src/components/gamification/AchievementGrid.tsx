'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { Achievement } from '@/types'

interface AchievementGridProps {
  achievements: Achievement[]
}

export function AchievementGrid({ achievements }: AchievementGridProps) {
  const { t, lang } = useT()

  if (achievements.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">🏅</div>
        <p>{t('profile.noAchievements')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {achievements.map(ach => (
        <Card
          key={ach.id}
          padding="sm"
          className={cn(
            'text-center',
            ach.earned
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'opacity-40'
          )}
        >
          <div className="text-3xl mb-2">{ach.emoji}</div>
          <p className="text-xs font-semibold text-white leading-tight">
            {lang === 'he' ? ach.title : (ach.titleEn || ach.title)}
          </p>
          {ach.earned && ach.earnedAt && (
            <p className="text-xs text-slate-500 mt-1">
              ✅
            </p>
          )}
          {!ach.earned && (
            <p className="text-xs text-slate-600 mt-1">🔒</p>
          )}
        </Card>
      ))}
    </div>
  )
}

export default AchievementGrid
