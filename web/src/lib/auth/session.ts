import type { AuthUser } from './types';

// The access token lives here — nowhere else. Not React state (a plain module
// object survives re-renders without needing a provider in scope, and reads
// synchronously from `lib/api/client.ts`, which is not a component) and never
// `localStorage` (CAR-217's whole point) or `sessionStorage` (same exposure to
// an XSS payload, and it would defeat "gone on tab close").
export type Session = { accessToken: string; user: AuthUser } | null;

let current: Session = null;
let generation = 0;
const listeners = new Set<() => void>();

export function getSession(): Session {
  return current;
}

export function setSession(next: Session): void {
  current = next;
  generation++;
  for (const listener of listeners) listener();
}

// What `refresh.ts` captures the moment a refresh network call actually
// starts — not just the generation counter, but *which* session, concretely,
// the call was made on behalf of. `userId`/`accessToken` are `null` when
// there was no session yet (bootstrap). Comparing this snapshot against the
// session at resolution time is what lets a stale response tell "nothing
// happened while I was in flight" apart from "the session was replaced by
// something else entirely" — the generation counter alone only answers
// *whether* something changed, not whether the change was safe to build on.
export type RefreshLineage = {
  generation: number;
  userId: string | null;
  accessToken: string | null;
};

export function captureLineage(): RefreshLineage {
  return { generation, userId: current?.user.id ?? null, accessToken: current?.accessToken ?? null };
}

// True when the current session is still, concretely, the one `lineage` was
// captured from — same user, same access token. Not just "some session
// exists": a logout followed by a fresh login as the very same user is a
// different session (a new access token), and must not be treated as a
// continuation of the one a stale response was computed for.
function isStillTheSameSession(lineage: RefreshLineage): boolean {
  if (lineage.userId === null) return current === null;
  return current !== null && current.user.id === lineage.userId && current.accessToken === lineage.accessToken;
}

// A successful refresh response, applied against the session it was
// actually requested for.
//
// If nothing wrote to the session while the call was in flight, the
// response is unambiguously current — apply it in full. If something did
// write (most notably a self-membership mutation's own synchronous patch),
// the response's user/business data no longer describes what's in the
// store, but the rotated access token inside it might still be the only
// valid one left — the server rotates it on every call that reaches it,
// win or lose. Adopt *only* that token, and only when the session is
// demonstrably still the one this call was made for (see
// `isStillTheSameSession`) and the response itself names that same user;
// otherwise — a logout, a different user's login, a re-established session
// with an already-different token — the response describes a session that
// no longer exists from this store's point of view, and is dropped whole.
export function applyRefreshSuccess(lineage: RefreshLineage, next: { accessToken: string; user: AuthUser }): void {
  if (generation === lineage.generation) {
    setSession(next);
    return;
  }
  if (current && isStillTheSameSession(lineage) && next.user.id === lineage.userId) {
    current = { ...current, accessToken: next.accessToken };
    generation++;
    for (const listener of listeners) listener();
  }
}

// A genuine 401 — the refresh cookie this call presented is dead. Unlike a
// success, a rejection carries nothing worth salvaging (no token to adopt),
// so it may only clear the session if *nothing at all* wrote to the store
// while the call was in flight — not even a same-token profile patch (a
// self-membership mutation, most notably). Any write at all means the
// session in front of us is not provably the one this 401 was about.
export function applyRefreshRejection(lineage: RefreshLineage): void {
  if (generation === lineage.generation) {
    setSession(null);
  }
}

// For `useSyncExternalStore` — see `lib/auth/AuthProvider.tsx`. Framework-free
// on purpose: `lib/api/client.ts` reads `getSession()` directly and has no
// reason to depend on React.
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
