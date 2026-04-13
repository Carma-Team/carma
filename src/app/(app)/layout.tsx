'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/context/AppContext'
import { Navigation } from '@/components/Navigation'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useApp()
  const router = useRouter()

  useEffect(() => {
    // Fetch current user if not in context
    if (!user) {
      fetch('/api/auth/me')
        .then(res => {
          if (!res.ok) throw new Error('Unauthorized')
          return res.json()
        })
        .then(data => setUser(data.user))
        .catch(() => router.push('/login'))
    }
  }, [user, setUser, router])

  if (!user) {
    return (
      <div className="min-h-screen bg-carma-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-spin mb-4">⚙️</div>
          <p className="text-slate-400">טוען...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-carma-dark pb-24">
      <main className="max-w-md mx-auto px-4">
        {children}
      </main>
      <Navigation />
    </div>
  )
}
