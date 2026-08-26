import { useContext } from 'react';
import { AuthContext } from '@/lib/auth/context';
import type { AuthContextValue } from '@/lib/auth/types';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
