/**
 * @fileoverview Authenticated HTTP client for business API calls
 * @module lib/api/client
 *
 * @description
 * `request<T>` attaches the in-memory access token as `Authorization: Bearer`,
 * and on a 401 tries exactly one silent refresh (via `lib/auth/refresh.ts`)
 * before retrying the call once. No consumers yet — CAR-217 is session
 * handling, not the business dashboard those calls belong to — but the retry
 * contract belongs here rather than being reinvented per feature.
 */
import { attemptRefresh } from '@/lib/auth/refresh';
import { getSession } from '@/lib/auth/session';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_URL;

function buildHeaders(extra?: HeadersInit): Record<string, string> {
  const token = getSession()?.accessToken;
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra as Record<string, string> | undefined),
  };
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = () => fetch(`${BASE_URL}${path}`, { ...options, credentials: 'include', headers: buildHeaders(options.headers) });

  let res = await doFetch();

  // Exactly one retry, and only after a refresh that actually succeeded — a
  // session that cannot be refreshed must surface as a failure here, not loop.
  if (res.status === 401 && (await attemptRefresh())) {
    res = await doFetch();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof data.detail === 'string' ? data.detail : 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
