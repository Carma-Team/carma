import { useEffect, useState, type ReactNode } from 'react';
import { LanguageContext } from './context';
import type { Language } from './types';

const STORAGE_KEY = 'carma_lang';
const DEFAULT_LANGUAGE: Language = 'HE';

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'HE' || stored === 'EN' ? stored : DEFAULT_LANGUAGE;
}

// Direction is applied once, here, at the document root — components style
// themselves with logical CSS properties (inline-start/end) so they flip for
// free instead of needing a per-component RTL fix.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    document.documentElement.dir = lang === 'HE' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang.toLowerCase();
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}
