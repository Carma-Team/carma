import { useContext } from 'react';
import { LanguageContext } from '@/i18n/context';
import type { LanguageContextValue } from '@/i18n/types';

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
