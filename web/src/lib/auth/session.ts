import type { AuthUser } from './types';

// The access token lives here — nowhere else. Not React state (a plain module
// object survives re-renders without needing a provider in scope, and reads
// synchronously from `lib/api/client.ts`, which is not a component) and never
// `localStorage` (CAR-217's whole point) or `sessionStorage` (same exposure to
// an XSS payload, and it would defeat "gone on tab close").
export type Session = { accessToken: string; user: AuthUser } | null;

let current: Session = null;
const listeners = new Set<() => void>();

export function getSession(): Session {
  return current;
}

export function setSession(next: Session): void {
  current = next;
  for (const listener of listeners) listener();
}

// For `useSyncExternalStore` — see `lib/auth/AuthProvider.tsx`. Framework-free
// on purpose: `lib/api/client.ts` reads `getSession()` directly and has no
// reason to depend on React.
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
