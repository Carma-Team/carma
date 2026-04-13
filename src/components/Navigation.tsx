'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/hooks/useTranslation'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard',    key: 'nav.dashboard',    icon: '🏠' },
  { href: '/roadmap',      key: 'nav.roadmap',      icon: '🗺️' },
  { href: '/marketplace',  key: 'nav.marketplace',  icon: '🎁' },
  { href: '/leaderboard',  key: 'nav.leaderboard',  icon: '🏆' },
  { href: '/profile',      key: 'nav.profile',      icon: '👤' },
]

export function Navigation() {
  const pathname = usePathname()
  const { t } = useT()
  const { user } = useApp()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-carma-dark/95 backdrop-blur-xl border-t border-carma-border safe-area-inset-bottom">
      <div className="flex items-center justify-around px-2 py-2 max-w-md mx-auto">
        {NAV_ITEMS.map(item => {
          const isActive = pathname.startsWith(item.href)
          const isProfile = item.href === '/profile'

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all min-w-0',
                isActive
                  ? 'text-brand-400 bg-brand-500/10'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <div className="relative">
                <span className="text-xl leading-none">{item.icon}</span>
                {isProfile && user && (user as any).unreadNotifications > 0 && (
                  <span className="absolute -top-1 -end-1 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                    {Math.min((user as any).unreadNotifications, 9)}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none truncate max-w-[40px]">
                {t(item.key)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default Navigation
