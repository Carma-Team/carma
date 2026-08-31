/**
 * @fileoverview Submit and look up a business join request (CAR-42's
 * endpoint, consumed by CAR-203's public registration page).
 * @module lib/api/businessRegistration
 *
 * @description
 * Deliberately not routed through `lib/api/client.ts`'s `request()`, and the
 * access token is a parameter here, never `lib/auth/session.ts`'s shared
 * store. That store is what `AuthProvider`/`ProtectedRoute` read app-wide —
 * writing the OTP-verified applicant's short-lived token there would make an
 * anonymous join-request submission look like a signed-in business session
 * to the rest of the SPA. The token this module needs lives only in the
 * calling page's own state, for the one call it authenticates.
 */
import { ApiError } from './client';
import type { BusinessCategory } from '@/lib/businessCategory';

const BASE_URL = import.meta.env.VITE_API_URL;

async function authedRequest<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError(0, 'Network error');
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

// CAR-203 (revised): address text is the primary input; `locationLat/Lng`
// are derived from it via `lib/api/geocoding.ts`, with a map shown only to
// confirm or correct the result — never collected as the applicant's
// primary way of giving a location, and never assumed from the device's own
// position. This is what satisfies `server/app/schemas/business_join_request.py`'s
// required, non-nullable `location_lat`/`location_lng` without fabricating
// a value or changing the backend contract.
export type JoinRequestPayload = {
  name: string;
  nameHe: string | null;
  category: BusinessCategory;
  address: string;
  locationLat: number;
  locationLng: number;
  registrationNumber: string;
  contactPerson: string;
};

export type JoinRequestStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type JoinRequestStatusOut = {
  status: JoinRequestStatus;
  createdAt: string | null;
  reviewerNote: string | null;
};

export type SubmitResult =
  | { outcome: 'ok'; id: string; createdAt: string }
  // `submit()` in server/app/services/business_join_requests.py answers 409
  // for three different reasons — the caller's own pending request, this
  // registration number pending under a *different* applicant, or it
  // already belonging to an approved business — all as a plain-text
  // `detail` string with no structured `code` (unlike e.g. VOUCHER_* on the
  // redemption endpoints). Distinguishing them here would mean matching on
  // that text, which the backend makes no promise to keep stable. Collapsed
  // into one honest "could not submit, here's why it might be" outcome
  // instead of guessing which one happened — see the CAR-203 hand-off for
  // the backend contract gap this leaves (a structured code per reason,
  // mirroring `approve()`'s own ALREADY_OWNS_BUSINESS / etc. pattern in the
  // same file, would resolve it).
  | { outcome: 'conflict' }
  | { outcome: 'rate_limited'; retryAfterSeconds: number | null }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export async function submitJoinRequest(payload: JoinRequestPayload, accessToken: string): Promise<SubmitResult> {
  try {
    const { id, createdAt } = await authedRequest<{ id: string; createdAt: string }>('/api/business/join-requests', accessToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', id, createdAt };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) return { outcome: 'network_error' };
      if (err.status === 409) return { outcome: 'conflict' };
      if (err.status === 429) return { outcome: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds ?? null };
      return { outcome: 'unexpected_error' };
    }
    return { outcome: 'unexpected_error' };
  }
}

export type StatusResult =
  | { outcome: 'ok'; status: JoinRequestStatusOut }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export async function getJoinRequestStatus(accessToken: string): Promise<StatusResult> {
  try {
    const status = await authedRequest<JoinRequestStatusOut>('/api/business/join-requests/me', accessToken);
    return { outcome: 'ok', status };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return { outcome: 'network_error' };
    return { outcome: 'unexpected_error' };
  }
}
