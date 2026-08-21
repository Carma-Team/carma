import { authApi } from './authApi';
import { setSession } from './session';

let inFlight: Promise<boolean> | null = null;

// Shared by `AuthProvider`'s bootstrap-on-mount and `lib/api/client.ts`'s
// retry-on-401 — both call this, never `authApi.refresh()` directly. The
// server rotates the cookie on every refresh (see
// `services/auth.py::refresh_session`), so two independent calls in flight at
// once would race that rotation: the loser presents an already-spent cookie
// and is treated as a stolen one, which revokes the session the winner just
// renewed. One in-flight promise, shared by every caller, makes that race
// impossible instead of just unlikely.
export function attemptRefresh(): Promise<boolean> {
  if (!inFlight) {
    inFlight = authApi
      .refresh()
      .then((res) => {
        setSession({ accessToken: res.token, user: res.user });
        return true;
      })
      .catch(() => {
        setSession(null);
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
