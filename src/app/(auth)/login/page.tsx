'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

export default function LoginPage() {
  const { t } = useT()
  const { setUser, addToast } = useApp()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError(t('auth.errors.emailRequired'))
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('auth.errors.invalidCredentials'))
        return
      }

      setUser(data.user)
      router.push('/dashboard')
    } catch {
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-carma-dark flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="text-6xl mb-3">🚗</div>
        <h1 className="text-3xl font-black text-white">CARMA</h1>
        <p className="text-slate-400 mt-1">{t('app.tagline')}</p>
      </div>

      <div className="w-full max-w-sm">
        <h2 className="text-xl font-bold text-white mb-6 text-center">{t('auth.login')}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm text-slate-400 block mb-1.5">{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              className="w-full bg-carma-card border border-carma-border rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 block mb-1.5">{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              className="w-full bg-carma-card border border-carma-border rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
              autoComplete="current-password"
              dir="ltr"
            />
          </div>

          <Button type="submit" fullWidth size="lg" loading={loading}>
            {t('auth.loginBtn')}
          </Button>
        </form>

        <p className="text-center mt-6 text-slate-400 text-sm">
          {t('auth.noAccount')}{' '}
          <Link href="/register" className="text-brand-400 font-semibold hover:underline">
            {t('auth.register')}
          </Link>
        </p>

        {/* Demo hint */}
        <div className="mt-6 p-3 bg-white/5 rounded-xl border border-white/10 text-center">
          <p className="text-xs text-slate-500">דוגמה: your@email.com / password123</p>
        </div>
      </div>
    </div>
  )
}
