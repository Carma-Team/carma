'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean
  glow?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export function Card({ glass, glow, padding = 'md', className, children, ...props }: CardProps) {
  const paddingClass = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  }[padding]

  return (
    <div
      className={cn(
        'rounded-2xl border',
        glass
          ? 'bg-white/5 backdrop-blur-sm border-white/10'
          : 'bg-carma-card border-carma-border',
        glow && 'shadow-lg shadow-brand-500/10',
        paddingClass,
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export default Card
