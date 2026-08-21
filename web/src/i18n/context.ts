import { createContext } from 'react';
import type { LanguageContextValue } from './types';

// The context instance lives in its own file (react-refresh/only-export-components
// wants component files to export only components) — LanguageContext.tsx has
// the provider, hooks/useLanguage.ts has the hook, both import the instance from here.
export const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);
