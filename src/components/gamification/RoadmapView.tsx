'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Progress } from '@/components/ui/Progress'
import { LEVELS, getLevelProgress } from '@/lib/constants'

interface RoadmapViewProps {
  currentLevel: number
  totalPoints: number
}

export function RoadmapView({ currentLevel, totalPoints }: RoadmapViewProps) {
  const { t, lang } = useT()

  return (
    <div className="space-y-3">
      {LEVELS.map((lvl) => {
        const isCompleted = currentLevel > lvl.level
        const isCurrent = currentLevel === lvl.level
        const isLocked = currentLevel < lvl.level
        const progress = isCurrent ? getLevelProgress(totalPoints, currentLevel) : isCompleted ? 100 : 0

        return (
          <div key={lvl.level} className="relative">
            {/* Connector line */}
            {lvl.level < 10 && (
              <div className={`absolute start-6 top-full w-0.5 h-3 z-0 ${isCompleted ? 'bg-brand-500' : 'bg-carma-border'}`} />
            )}

            <Card
              className={`relative z-10 transition-all ${
                isCurrent
                  ? 'border-brand-500/60 bg-brand-500/5 shadow-lg shadow-brand-500/10'
                  : isCompleted
                  ? 'border-green-500/30 opacity-90'
                  : 'opacity-50'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Level icon */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-xl flex-shrink-0 border-2 ${
                    isCompleted
                      ? 'border-green-500 bg-green-500/20'
                      : isCurrent
                      ? 'border-brand-500 bg-brand-500/20'
                      : 'border-carma-border bg-carma-dark'
                  }`}
                >
                  {isCompleted ? '✅' : lvl.icon}
                </div>

                {/* Level info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs text-slate-500">{t('common.level')} {lvl.level}</span>
                      <h3 className="text-white font-bold text-sm">
                        {lang === 'he' ? lvl.name : lvl.nameEn}
                      </h3>
                    </div>
                    {isCurrent && (
                      <span className="text-xs bg-brand-500/20 text-brand-400 px-2 py-0.5 rounded-full border border-brand-500/30">
                        {t('roadmap.currentLevel')}
                      </span>
                    )}
                  </div>

                  {isCurrent && (
                    <div className="mt-2">
                      <Progress value={progress} size="sm" color={lvl.color} />
                      <p className="text-xs text-slate-400 mt-1">
                        {totalPoints.toLocaleString()} / {lvl.maxPoints === Infinity ? '∞' : lvl.maxPoints.toLocaleString()} {t('common.points')}
                      </p>
                    </div>
                  )}

                  {lvl.perks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {lvl.perks.slice(0, 2).map(perk => (
                        <span key={perk} className="text-xs text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full">
                          {perk}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )
      })}
    </div>
  )
}

export default RoadmapView
