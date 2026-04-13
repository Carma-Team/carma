'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useApp } from '@/context/AppContext'
import { useT } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

export default function RegisterPage() {
  const { t } = useT()
  const { setUser } = useApp()
  const router = useRouter()

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', city: '', age: '', licenseYear: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name) { setError(t('auth.errors.nameRequired')); return }
    if (!form.email) { setError(t('auth.errors.emailRequired')); return }
    if (!form.password || form.password.length < 6) { setError(t('auth.errors.passwordTooShort')); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || t('common.error')); return }
      setUser(data.user)
      router.push('/onboarding')
    } catch {
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-carma-dark flex flex-col p-6">
      <Link href="/login" className="text-slate-400 mb-6 text-sm hover:text-white">
        ← {t('common.back')}
      </Link>

      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">🚗</div>
          <h1 className="text-2xl font-black text-white">CARMA</h1>
          <p className="text-slate-400 mt-1">{t('auth.register')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {[
            { field: 'name', label: t('auth.name'), type: 'text', placeholder: t('auth.namePlaceholder'), dir: 'auto' },
            { field: 'email', label: t('auth.email'), type: 'email', placeholder: t('auth.emailPlaceholder'), dir: 'ltr' },
            { field: 'password', label: t('auth.password'), type: 'password', placeholder: t('auth.passwordPlaceholder'), dir: 'ltr' },
            { field: 'phone', label: t('auth.phone'), type: 'tel', placeholder: '050-0000000', dir: 'ltr' },
            { field: 'city', label: t('auth.city'), type: 'text', placeholder: 'תל אביב', dir: 'auto' },
          ].map(({ field, label, type, placeholder, dir }) => (
            <div key={field}>
              <label className="text-xs text-slate-400 block mb-1">{label}</label>
              <input
                type={type}
                value={form[field as keyof typeof form]}
                onChange={update(field)}
                placeholder={placeholder}
                dir={dir}
                className="w-full bg-carma-card border border-carma-border rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('auth.age')}</label>
              <input type="number" value={form.age} onChange={update('age')} placeholder="22" min="16" max="30"
                className="w-full bg-carma-card border border-carma-border rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors" dir="ltr" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('auth.licenseYear')}</label>
              <input type="number" value={form.licenseYear} onChange={update('licenseYear')} placeholder="2023" min="2000" max="2025"
                className="w-full bg-carma-card border border-carma-border rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors" dir="ltr" />
            </div>
          </div>

          <div className="pt-2">
            <Button type="submit" fullWidth size="lg" loading={loading}>
              {t('auth.registerBtn')}
            </Button>
          </div>
        </form>

        <p className="text-center mt-4 text-slate-400 text-sm">
          {t('auth.hasAccount')}{' '}
          <Link href="/login" className="text-brand-400 font-semibold hover:underline">
            {t('auth.login')}
          </Link>
        </p>
      </div>
    </div>
  )
}
