/**
 * @fileoverview Sign-in, refresh and sign-out — the three calls that touch the
 * browser's session cookie directly.
 * @module lib/auth/authApi
 *
 * @description
 * Deliberately not routed through `lib/api/client.ts`'s `request()`: that
 * wrapper retries a 401 by calling `/api/auth/refresh` itself, and refresh
 * failing is not something refresh can retry its way out of. Calling these
 * three with a plain `fetch` keeps that loop structurally impossible instead
 * of relying on a guard to remember to skip it.
 */
import type { AuthUser } from './types';

const BASE_URL = import.meta.env.VITE_API_URL;

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

type AuthResponse = { token: string; user: AuthUser };

// A hung request here is worse than a failed one: `lib/auth/refresh.ts`'s
// single-flight guard means every other caller waiting on a refresh is
// waiting on *this* promise, and a bootstrap that never settles leaves
// ProtectedRoute on its loading spinner forever. This bounds it — the abort
// rejects the fetch, which `refresh.ts` reads as a transient failure (see
// there for why that must not be treated as "the session is dead").
const REQUEST_TIMEOUT_MS = 10_000;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      // The refresh cookie is httpOnly — this is what makes the browser attach
      // it at all. Every one of these three calls needs it, login included: a
      // login response is what sets the cookie in the first place.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // Server-checked on /refresh and /logout — see `core.deps.require_browser_header`.
        // Sent here too, uniformly, rather than only on the two that need it.
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // status 0: not a real HTTP response — a network failure or our own
    // abort, never the server. `refresh.ts` treats anything but a genuine
    // 401 as transient, so this deliberately does not need to distinguish
    // "timed out" from "the network dropped" any further than that.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AuthApiError(0, 'Request timed out');
    }
    throw new AuthApiError(0, 'Network error');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new AuthApiError(res.status, typeof data.detail === 'string' ? data.detail : 'Request failed');
  }
  return res.json();
}

export const authApi = {
  login: (email: string, password: string) => post<AuthResponse>('/api/auth/login', { email, password }),
  // Only the three fields a CAR-118 sign-up needs — `RegisterIn` also accepts
  // phone/city/age/licenseYear, but this flow has nowhere to collect them.
  register: (name: string, email: string, password: string) =>
    post<AuthResponse>('/api/auth/register', { name, email, password }),
  // CAR-265: the phone+OTP door into the same CAR-217 session `login` and
  // `register` establish — for an approved, phone-only business owner who
  // has no password to type. Deliberately not `lib/auth/otpApi.ts`, whose
  // fetch never sends `credentials: 'include'` — this call is the one that
  // sets the session cookie, so it needs this module's `post()`, not that one.
  loginWithOtp: (phone: string, code: string) => post<AuthResponse>('/api/auth/otp/login', { phone, code }),
  refresh: () => post<AuthResponse>('/api/auth/refresh'),
  logout: () => post<{ message: string }>('/api/auth/logout'),
};
