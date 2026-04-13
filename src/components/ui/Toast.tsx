'use client'

import React from 'react'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'
import type { ToastMessage } from '@/types'

const ICONS: Record<ToastMessage['type'], string> = {
  success: '✅',
  error:   '❌',
  info:    'ℹ️',
  warning: '⚠️',
}

const BG: Record<ToastMessage['type'], string> = {
  success: 'bg-green-900/90 border-green-700',
  error:   'bg-red-900/90 border-red-700',
  info:    'bg-blue-900/90 border-blue-700',
  warning: 'bg-amber-900/90 border-amber-700',
}

function ToastItem({ toast }: { toast: ToastMessage }) {
  const { removeToast } = useApp()

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-xl border shadow-xl text-white text-sm animate-slide-up',
        BG[toast.type]
      )}
    >
      <span className="text-base mt-0.5 flex-shrink-0">{ICONS[toast.type]}</span>
      <p className="flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  )
}

export function ToastContainer() {
  const { toasts } = useApp()
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 left-4 z-[100] flex flex-col gap-2 max-w-sm ms-auto pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}

export default ToastContainer
