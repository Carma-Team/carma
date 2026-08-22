import { authApi, AuthApiError } from './authApi';
import { setSession } from './session';

// 'ok' — session (re)established, holding a fresh access token.
// 'rejected' — the server looked at the cookie and answered "no": missing,
//   expired, or reuse-detected (`services/auth.py`'s `REFRESH_REJECTED`,
//   always a 401). The session is actually dead; ending it locally too is
//   correct, not just convenient.
// 'transient' — the call did not complete as a real answer either way: a
//   network failure, our own timeout, a 429, or a 5xx. This says nothing
//   about whether the session is valid — treating it as 'rejected' would
//   force a sign-in-again on a caller who did nothing wrong, on nothing more
//   than a bad moment on the wire.
export type RefreshOutcome = 'ok' | 'rejected' | 'transient';

let inFlight: Promise<RefreshOutcome> | null = null;

// Shared by `AuthProvider`'s bootstrap-on-mount and `lib/api/client.ts`'s
// retry-on-401 — both call this, never `authApi.refresh()` directly. The
// server rotates the cookie on every refresh (see
// `services/auth.py::refresh_session`), so two independent calls in flight at
// once would race that rotation: the loser presents an already-spent cookie
// and is treated as a stolen one, which revokes the session the winner just
// renewed. One in-flight promise, shared by every caller, makes that race
// impossible instead of just unlikely.
export function attemptRefresh(): Promise<RefreshOutcome> {
  if (!inFlight) {
    inFlight = authApi
      .refresh()
      .then((res): RefreshOutcome => {
        setSession({ accessToken: res.token, user: res.user });
        return 'ok';
      })
      .catch((err: unknown): RefreshOutcome => {
        if (err instanceof AuthApiError && err.status === 401) {
          setSession(null);
          return 'rejected';
        }
        // Deliberately not touching the session store here — see
        // 'transient' above. Whatever session state existed before this
        // call (none, at bootstrap; a live one, mid-session) is left alone.
        return 'transient';
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
