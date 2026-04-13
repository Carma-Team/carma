'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { getLevelConfig } from '@/lib/constants'

interface LevelBadgeProps {
  level: number
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  lang?: 'he' | 'en'
  className?: string
}

export function LevelBadge({ level, size = 'md', showName = false, lang = 'he', className }: LevelBadgeProps) {
  const config = getLevelConfig(level)

  const sizeClasses = {
    sm:  'w-8 h-8 text-sm',
    md:  'w-12 h-12 text-xl',
    lg:  'w-16 h-16 text-3xl',
  }[size]

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center border-2',
          sizeClasses
        )}
        style={{
          borderColor: config.color,
          background: `${config.color}20`,
          boxShadow: `0 0 12px ${config.color}40`,
        }}
      >
        {config.icon}
      </div>
      {showName && (
        <span className="text-xs font-semibold" style={{ color: config.color }}>
          {lang === 'he' ? config.name : config.nameEn}
        </span>
      )}
    </div>
  )
}

export default LevelBadge
