'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number // 0-100
  max?: number
  color?: string
  size?: 'sm' | 'md' | 'lg'
  animated?: boolean
  className?: string
  showLabel?: boolean
}

export function Progress({
  value,
  max = 100,
  color,
  size = 'md',
  animated = false,
  className,
  showLabel = false,
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  const heightClass = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  }[size]

  const defaultColor =
    pct >= 80 ? '#22c55e' : pct >= 60 ? '#84cc16' : pct >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('w-full bg-slate-700/50 rounded-full overflow-hidden', heightClass)}>
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            animated && 'animate-pulse-slow'
          )}
          style={{
            width: `${pct}%`,
            backgroundColor: color ?? defaultColor,
            boxShadow: `0 0 8px ${color ?? defaultColor}60`,
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-slate-400 mt-1">{Math.round(pct)}%</span>
      )}
    </div>
  )
}

export default Progress
