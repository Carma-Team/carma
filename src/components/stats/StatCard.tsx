'use client'

import React from 'react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  emoji?: string
  color?: string
  small?: boolean
  className?: string
}

export function StatCard({ label, value, emoji, color = '#22c55e', small, className }: StatCardProps) {
  return (
    <Card padding="sm" className={cn('text-center', className)}>
      {emoji && <div className={cn('mb-1', small ? 'text-xl' : 'text-3xl')}>{emoji}</div>}
      <p
        className={cn('font-black', small ? 'text-xl' : 'text-2xl')}
        style={{ color }}
      >
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-0.5 leading-tight">{label}</p>
    </Card>
  )
}

export default StatCard
