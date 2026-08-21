import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AuthContext } from './context';
import { authApi } from './authApi';
import { attemptRefresh } from './refresh';
import { getSession, setSession, subscribeSession } from './session';
import type { AuthContextValue, AuthStatus } from './types';

// Every mount — a fresh tab, or a reload — starts with nothing in memory and
// one question: does the refresh cookie still name a live session? That is
// the only way a reload can end up "authenticated" again, so nothing renders
// as either authenticated or unauthenticated until this settles.
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    attemptRefresh().finally(() => {
      if (!cancelled) setBootstrapped(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    // `res.token` is already short-lived, not mobile's 7-day one — the
    // server mints it that way for this exact call because `authApi.login`
    // (like every call in this module) sends `X-Requested-With`, which is
    // what tells `/api/auth/login` a browser is asking. See
    // `services/auth.py::login_with_password`. No follow-up refresh needed
    // just to downgrade it.
    setSession({ accessToken: res.token, user: res.user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort — a network failure here must not surface to the caller
      // as a failed logout; `finally` below ends the tab's session regardless.
    } finally {
      // Cleared even if the network call fails — the tab's session ends
      // either way; only the server-side row might outlive it until its own
      // expiry, which is the acceptable half of an offline logout.
      setSession(null);
    }
  }, []);

  const status: AuthStatus = !bootstrapped ? 'loading' : session ? 'authenticated' : 'unauthenticated';

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, login, logout }),
    [status, session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
