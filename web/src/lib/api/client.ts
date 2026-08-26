/**
 * @fileoverview Authenticated HTTP client for business API calls
 * @module lib/api/client
 *
 * @description
 * `request<T>` attaches the in-memory access token as `Authorization: Bearer`,
 * and on a 401 tries exactly one silent refresh (via `lib/auth/refresh.ts`)
 * before retrying the call once. First consumer is `lib/api/vouchers.ts`
 * (CAR-67) — the retry contract belongs here rather than being reinvented per
 * feature.
 */
import { attemptRefresh } from '@/lib/auth/refresh';
import { getSession } from '@/lib/auth/session';

export class ApiError extends Error {
  readonly status: number;
  // Set only when the server sent a structured `{code, message}` detail (see
  // `services/business.py`'s VOUCHER_* codes) instead of a bare string. A
  // caller that needs to tell two same-status failures apart reads this, not
  // `message` — see CAR-67.
  readonly code?: string;
  // From the standard `Retry-After` header; only ever present on a 429.
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
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

// Same status-0 convention as `lib/auth/authApi.ts`'s `AuthApiError`: not a
// real HTTP response, so there is no status to report. Without this, a fetch
// that never reaches the server (offline, DNS, CORS) and a fetch that reaches
// it but returns an unparsable body are indistinguishable to a caller — both
// would otherwise surface as the same raw, non-`ApiError` rejection.
async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, 'Network error');
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = () => safeFetch(`${BASE_URL}${path}`, { ...options, credentials: 'include', headers: buildHeaders(options.headers) });

  let res = await doFetch();

  // Exactly one retry, and only after a refresh that actually succeeded — not
  // just settled. `attemptRefresh()` returns a string in every case (`'ok'`,
  // `'rejected'`, `'transient'`), so a truthy check here would retry after a
  // rejection or a timeout too; only `'ok'` means there is a new token worth
  // retrying with. A refresh that cannot happen right now must surface as this
  // one call failing, not loop, and — per `refresh.ts` — must not end the
  // session over what might be nothing more than a bad moment on the wire.
  if (res.status === 401) {
    const outcome = await attemptRefresh();
    if (outcome === 'ok') {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail: unknown = data.detail;
    const detailObj = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : undefined;
    const message =
      typeof detail === 'string' ? detail : typeof detailObj?.message === 'string' ? detailObj.message : 'Request failed';
    const code = typeof detailObj?.code === 'string' ? detailObj.code : undefined;
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader !== null && retryAfterHeader !== '' ? Number(retryAfterHeader) : NaN;
    throw new ApiError(res.status, message, code, Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
