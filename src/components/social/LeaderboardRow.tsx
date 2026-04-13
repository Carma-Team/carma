'use client'

import React from 'react'
import { LevelBadge } from '@/components/gamification/LevelBadge'
import { cn } from '@/lib/utils'
import type { LeaderboardEntry } from '@/types'

interface LeaderboardRowProps {
  entry: LeaderboardEntry
  isCurrentUser: boolean
  lang?: 'he' | 'en'
}

const RANK_STYLES: Record<number, string> = {
  1: 'text-amber-400 text-xl',
  2: 'text-slate-300 text-lg',
  3: 'text-amber-600 text-lg',
}

export function LeaderboardRow({ entry, isCurrentUser, lang = 'he' }: LeaderboardRowProps) {
  const rankLabel = entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl transition-colors',
        isCurrentUser
          ? 'bg-brand-500/10 border border-brand-500/30'
          : 'hover:bg-white/5'
      )}
    >
      {/* Rank */}
      <span className={cn('w-8 text-center font-bold', RANK_STYLES[entry.rank] || 'text-slate-400')}>
        {rankLabel}
      </span>

      {/* Level badge */}
      {entry.user && (
        <LevelBadge level={entry.user.level} size="sm" lang={lang} />
      )}

      {/* Name + city */}
      <div className="flex-1 min-w-0">
        <p className={cn('font-semibold text-sm', isCurrentUser ? 'text-brand-300' : 'text-white')}>
          {entry.user?.name ?? ''}
          {isCurrentUser && <span className="text-xs text-brand-500 ms-1">(אתה)</span>}
        </p>
        {entry.user?.city && (
          <p className="text-xs text-slate-500">{entry.user.city}</p>
        )}
      </div>

      {/* Score */}
      <span className="font-bold text-white text-sm">{entry.score.toLocaleString()}</span>
    </div>
  )
}

export default LeaderboardRow
