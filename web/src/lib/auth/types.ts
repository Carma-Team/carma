// Deliberately narrower than the server's `UserOut` — CAR-217 is authentication
// and session handling, not the business dashboard. Extend as the fields a
// business screen actually needs, rather than mirroring every driver-only
// field (points, level, bluetooth device, …) up front.
export type AuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: 'DRIVER' | 'BUSINESS' | 'ADMIN';
  businessId: string | null;
  businessCategory: string | null;
  // Raw fields, not a pre-resolved fallback — callers pick businessNameHe ??
  // businessName themselves (see AppShell), same as the server's UserOut.
  businessName: string | null;
  businessNameHe: string | null;
};

// 'error' is distinct from 'unauthenticated': it means the one-time bootstrap
// check (on mount, or a reload) could not get a real answer — a network
// failure, a timeout, a 429, a 5xx — not that the server said no. Landing on
// 'unauthenticated' for that would force a sign-in-again on a valid session
// just because a request didn't complete; see `lib/auth/refresh.ts`.
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Re-runs the bootstrap check from an 'error' status. A no-op from any
  // other status — there is nothing to retry once bootstrap has settled for
  // real.
  retry: () => void;
};
