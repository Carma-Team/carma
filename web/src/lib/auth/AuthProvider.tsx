import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AuthContext } from './context';
import { authApi } from './authApi';
import { attemptRefresh } from './refresh';
import { getSession, setSession, subscribeSession } from './session';
import type { AuthContextValue, AuthStatus } from './types';

// Only the *bootstrap* check's own outcome — not settled yet, settled with a
// real answer, or settled without one (see `lib/auth/refresh.ts`'s
// 'transient'). Once 'done', `status` below tracks `session` directly: a
// later refresh triggered by `lib/api/client.ts` (a business call hitting an
// expired token mid-session) updates `session` on its own, and that must
// still flip `status` to 'unauthenticated' if it comes back rejected — this
// phase exists only to cover the one-time gap before there is a session to
// track at all.
type BootstrapPhase = 'pending' | 'done' | 'error';

// Every mount — a fresh tab, or a reload — starts with nothing in memory and
// one question: does the refresh cookie still name a live session? That is
// the only way a reload can end up "authenticated" again, so nothing renders
// as either authenticated or unauthenticated until this settles.
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>('pending');

  useEffect(() => {
    let cancelled = false;
    attemptRefresh().then((outcome) => {
      if (!cancelled) setBootstrapPhase(outcome === 'transient' ? 'error' : 'done');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // User-triggered re-run from an 'error' status — AuthProvider itself never
  // unmounts mid-session, so this does not need the mount effect's own
  // cancellation guard (that guards React StrictMode's double-invoke on
  // mount, not anything relevant to a button click).
  const retry = useCallback(() => {
    setBootstrapPhase('pending');
    void attemptRefresh().then((outcome) => {
      setBootstrapPhase(outcome === 'transient' ? 'error' : 'done');
    });
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

  const status: AuthStatus =
    bootstrapPhase === 'pending'
      ? 'loading'
      : bootstrapPhase === 'error'
        ? 'error'
        : session
          ? 'authenticated'
          : 'unauthenticated';

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, login, logout, retry }),
    [status, session, login, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
