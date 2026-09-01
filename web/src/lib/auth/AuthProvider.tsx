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
    // Settles `bootstrapPhase`, not just outrun by `session` taking priority
    // below — a login this successful is itself proof the bootstrap question
    // ("is there a live session?") has a real, current answer, so a *later*
    // sign-out or session rejection must fall through to 'unauthenticated',
    // never resurface whatever transient failure the tab's original mount
    // happened to hit (CAR-118 review item 5).
    setBootstrapPhase('done');
  }, []);

  const loginWithOtp = useCallback(async (phone: string, code: string) => {
    // Same reasoning as `login` above — `authApi.loginWithOtp` sends
    // `X-Requested-With` uniformly, so `/api/auth/otp/login` (CAR-265)
    // already recognizes this as a browser call and mints the short web TTL
    // and refresh cookie without a follow-up refresh.
    const res = await authApi.loginWithOtp(phone, code);
    setSession({ accessToken: res.token, user: res.user });
    setBootstrapPhase('done');
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    // Same short-lived-from-the-start reasoning as `login` above — `authApi`
    // sends `X-Requested-With` uniformly, so `/api/auth/register` already
    // recognizes this as a browser call (see
    // `services/auth.py::register_with_password`) and mints the right TTL
    // and refresh cookie without a follow-up refresh.
    const res = await authApi.register(name, email, password);
    setSession({ accessToken: res.token, user: res.user });
    setBootstrapPhase('done');
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

  // A live `session` is checked before `bootstrapPhase` — not after — so a
  // `login`/`register` call that lands after a *transient* bootstrap failure
  // (an already-mounted app, `status: 'error'`, still showing the sign-in
  // form) reaches 'authenticated' immediately. Neither of those sets
  // `bootstrapPhase` themselves; without this ordering the stale 'error' from
  // the earlier, unrelated bootstrap attempt would keep overriding a session
  // that is genuinely live. `session` itself is never set from a stale
  // response — `setSession`/`applyRefreshSuccess`/`applyRefreshRejection`
  // already guard that (see `lib/auth/refresh.ts`'s captured lineage).
  const status: AuthStatus = session
    ? 'authenticated'
    : bootstrapPhase === 'pending'
      ? 'loading'
      : bootstrapPhase === 'error'
        ? 'error'
        : 'unauthenticated';

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, login, loginWithOtp, register, logout, retry }),
    [status, session, login, loginWithOtp, register, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
