'use client'

import React from 'react'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import type { LeaderboardEntry } from '@/types'

interface FriendComparisonProps {
  entries: LeaderboardEntry[]
  currentUserId: string
}

export function FriendComparison({ entries, currentUserId }: FriendComparisonProps) {
  const { t, lang } = useT()

  const currentUser = entries.find(e => e.userId === currentUserId)
  const friends = entries.filter(e => e.userId !== currentUserId).slice(0, 3)

  if (!currentUser || friends.length === 0) {
    return (
      <Card className="text-center py-6 text-slate-400">
        <p className="text-2xl mb-2">👥</p>
        <p>{t('leaderboard.noFriends')}</p>
      </Card>
    )
  }

  const maxScore = Math.max(...entries.map(e => e.score), 1)

  return (
    <div className="space-y-3">
      {entries.slice(0, 5).map(entry => {
        const isMe = entry.userId === currentUserId
        const pct = Math.round((entry.score / maxScore) * 100)

        return (
          <div key={entry.userId} className={`p-3 rounded-xl ${isMe ? 'bg-brand-500/10 border border-brand-500/30' : 'bg-white/5'}`}>
            <div className="flex justify-between items-center mb-2">
              <span className={`font-semibold text-sm ${isMe ? 'text-brand-300' : 'text-white'}`}>
                {entry.user?.name}
                {isMe && <span className="text-xs text-brand-500 ms-1">(אתה)</span>}
              </span>
              <span className="text-sm font-bold text-white">{entry.score.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${isMe ? 'bg-brand-500' : 'bg-slate-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default FriendComparison
