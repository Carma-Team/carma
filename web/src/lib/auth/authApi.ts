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

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new AuthApiError(res.status, typeof data.detail === 'string' ? data.detail : 'Request failed');
  }
  return res.json();
}

export const authApi = {
  login: (email: string, password: string) => post<AuthResponse>('/api/auth/login', { email, password }),
  refresh: () => post<AuthResponse>('/api/auth/refresh'),
  logout: () => post<{ message: string }>('/api/auth/logout'),
};
