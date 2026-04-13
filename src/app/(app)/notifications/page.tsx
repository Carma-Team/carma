'use client'

import React, { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatRelativeTime } from '@/lib/utils'
import type { Notification } from '@/types'

const TYPE_EMOJI: Record<string, string> = {
  trip_complete: '🚗',
  achievement:   '🏅',
  reward:        '🎁',
  system:        '📢',
}

export default function NotificationsPage() {
  const { user, setUser } = useApp()
  const { t, lang } = useT()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications')
      .then(res => res.json())
      .then(data => setNotifications(data.notifications))
      .finally(() => setLoading(false))
  }, [])

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    if (user) setUser({ ...user, unreadNotifications: 0 } as any)
  }

  async function markRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
  }

  const unreadCount = notifications.filter(n => !n.isRead).length

  return (
    <div className="pt-6 pb-4 page-enter">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-black text-white">{t('notifications.title')}</h1>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead}>
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 bg-carma-card rounded-2xl border border-carma-border animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-4xl mb-2">🔔</div>
          <p className="text-slate-400">{t('notifications.noNotifications')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => (
            <div
              key={notif.id}
              onClick={() => !notif.isRead && markRead(notif.id)}
              className={`flex gap-3 p-4 rounded-xl border transition-all cursor-pointer ${
                notif.isRead
                  ? 'bg-carma-card border-carma-border opacity-70'
                  : 'bg-brand-500/5 border-brand-500/30 hover:bg-brand-500/10'
              }`}
            >
              <div className="text-2xl flex-shrink-0">{TYPE_EMOJI[notif.type] || '📢'}</div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm">
                  {lang === 'he' ? notif.titleHe : (notif.titleEn || notif.titleHe)}
                </p>
                <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">
                  {lang === 'he' ? notif.bodyHe : (notif.bodyEn || notif.bodyHe)}
                </p>
                <p className="text-slate-600 text-xs mt-1">{formatRelativeTime(notif.createdAt, lang)}</p>
              </div>
              {!notif.isRead && (
                <div className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0 mt-2" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
