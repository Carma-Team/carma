import { useLanguage } from '@/hooks/useLanguage';
import en from '@/i18n/en';
import he from '@/i18n/he';
import type { TranslationMap } from '@/i18n/types';

const translations: Record<'HE' | 'EN', TranslationMap> = { HE: he, EN: en };

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in (current as object)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  return typeof current === 'string' ? current : path;
}

// Dot-notation lookup (e.g. t('common.retry')), matching the mobile app's
// i18n/useTranslation convention. Kept separate rather than shared — mobile
// is React Native and web is the browser, with no shared package between them.
export function useTranslation() {
  const { lang, setLang } = useLanguage();

  function t(key: string): string {
    return getNestedValue(translations[lang] as unknown as Record<string, unknown>, key);
  }

  return { t, lang, setLang };
}
