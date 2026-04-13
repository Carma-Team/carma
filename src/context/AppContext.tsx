'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AppUser, Language, ToastMessage } from '@/types'

interface AppContextValue {
  user: AppUser | null
  setUser: (user: AppUser | null) => void
  lang: Language
  setLang: (lang: Language) => void
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
  isLoading: boolean
  setIsLoading: (v: boolean) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [lang, setLangState] = useState<Language>('he')
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load language from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('carma_lang') as Language | null
    if (stored === 'he' || stored === 'en') {
      setLangState(stored)
      document.documentElement.dir = stored === 'he' ? 'rtl' : 'ltr'
      document.documentElement.lang = stored
    }
  }, [])

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang)
    localStorage.setItem('carma_lang', newLang)
    document.documentElement.dir = newLang === 'he' ? 'rtl' : 'ltr'
    document.documentElement.lang = newLang
  }, [])

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    const newToast: ToastMessage = { ...toast, id }
    setToasts(prev => [...prev, newToast])

    const duration = toast.duration ?? 3500
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        lang,
        setLang,
        toasts,
        addToast,
        removeToast,
        isLoading,
        setIsLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
