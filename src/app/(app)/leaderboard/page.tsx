'use client'

import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useTranslation'
import { LeaderboardRow } from '@/components/social/LeaderboardRow'
import { FriendComparison } from '@/components/social/FriendComparison'
import { Card } from '@/components/ui/Card'
import type { LeaderboardEntry, LeaderboardType } from '@/types'

export default function LeaderboardPage() {
  const { t, lang } = useT()
  const [type, setType] = useState<LeaderboardType>('national')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/leaderboard?type=${type}`)
      .then(res => res.json())
      .then(data => {
        setEntries(data.entries)
        setCurrentUserId(data.currentUserId)
      })
      .finally(() => setLoading(false))
  }, [type])

  const tabs: { key: LeaderboardType; labelKey: string }[] = [
    { key: 'friends',  labelKey: 'leaderboard.friends' },
    { key: 'city',     labelKey: 'leaderboard.city' },
    { key: 'national', labelKey: 'leaderboard.national' },
  ]

  return (
    <div className="pt-6 pb-4 page-enter">
      <h1 className="text-2xl font-black text-white mb-4">{t('leaderboard.title')}</h1>

      {/* Tabs */}
      <div className="flex bg-carma-card border border-carma-border rounded-xl p-1 gap-1 mb-4">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setType(tab.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              type === tab.key ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {type === 'friends' && entries.length > 0 && (
        <div className="mb-4">
          <FriendComparison entries={entries} currentUserId={currentUserId} />
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-16 bg-carma-card rounded-xl border border-carma-border animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-4xl mb-2">👥</p>
          <p className="text-slate-400">{t('leaderboard.noFriends')}</p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {entries.map((entry, i) => (
            <div key={entry.id}>
              {i > 0 && <div className="border-t border-carma-border" />}
              <LeaderboardRow
                entry={entry}
                isCurrentUser={entry.userId === currentUserId}
                lang={lang}
              />
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
