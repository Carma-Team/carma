'use client'

import React from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'level'

interface BadgeProps {
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  className?: string
  children: React.ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  default:  'bg-slate-700 text-slate-200',
  success:  'bg-green-500/20 text-green-400 border border-green-500/30',
  warning:  'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  danger:   'bg-red-500/20 text-red-400 border border-red-500/30',
  info:     'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  level:    'bg-brand-500/20 text-brand-400 border border-brand-500/30',
}

export function Badge({ variant = 'default', size = 'md', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold rounded-full',
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

export default Badge
