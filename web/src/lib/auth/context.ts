import { createContext } from 'react';
import type { AuthContextValue } from './types';

// Instance lives on its own (react-refresh/only-export-components wants
// component files to export only components) — mirrors i18n/context.ts +
// i18n/LanguageContext.tsx. AuthProvider.tsx has the provider,
// hooks/useAuth.ts has the hook, both import the instance from here.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
