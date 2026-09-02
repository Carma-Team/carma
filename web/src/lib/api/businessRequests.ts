/**
 * @fileoverview Admin review of business join requests (CAR-255)
 * @module lib/api/businessRequests
 *
 * @description
 * Wraps `GET/POST /api/admin/business-requests` on top of `lib/api/client.ts`'s
 * `request()` — the CAR-77 API is the single source of truth here; this file
 * adds no approval/rejection/state-transition logic of its own, only shapes
 * the server's responses into result unions the page switches on, the same
 * never-throw-for-an-expected-failure convention as `lib/api/businessMembers.ts`.
 * `code` on a conflict mirrors the server's structured `{code, message}` 409
 * body (`services/business_join_requests.py`'s `ALREADY_OWNS_BUSINESS`,
 * `REGISTRATION_NUMBER_TAKEN`, `APPLICANT_ROLE_INVALID`,
 * `INVALID_STATE_TRANSITION`) — the caller reads it only to decide whether to
 * reconcile the list, never to re-derive a decision itself.
 */
import { ApiError, request } from './client';

export type BusinessRequestStatus = 'pending' | 'approved' | 'rejected';

// The one TypeScript mirror of the server's `BusinessJoinRequestAdminOut`
// (server/app/schemas/business_join_request.py).
export type BusinessRequestAdmin = {
  id: string;
  status: BusinessRequestStatus;
  name: string;
  nameHe: string | null;
  category: string;
  locationLat: number;
  locationLng: number;
  address: string | null;
  registrationNumber: string;
  contactPerson: string;
  phone: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

export type BusinessRequestsListResult =
  | { outcome: 'ok'; requests: BusinessRequestAdmin[] }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type BusinessRequestActionResult =
  | { outcome: 'ok'; request: BusinessRequestAdmin }
  | { outcome: 'forbidden' }
  | { outcome: 'not_found' }
  // A decision already made elsewhere (another admin, a stale row) — the
  // server's message is shown as-is; the caller's job is to reconcile the
  // list with a refetch, not to guess what the current state now is.
  | { outcome: 'conflict'; code?: string; message: string }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function listErrorOutcome(err: unknown): 'forbidden' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
  }
  return 'unexpected_error';
}

function actionErrorResult(err: unknown): BusinessRequestActionResult {
  if (err instanceof ApiError) {
    if (err.status === 0) return { outcome: 'network_error' };
    if (err.status === 403) return { outcome: 'forbidden' };
    if (err.status === 404) return { outcome: 'not_found' };
    if (err.status === 409) return { outcome: 'conflict', code: err.code, message: err.message };
  }
  return { outcome: 'unexpected_error' };
}

export async function listBusinessRequests(status?: BusinessRequestStatus): Promise<BusinessRequestsListResult> {
  try {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const { requests } = await request<{ requests: BusinessRequestAdmin[] }>(`/api/admin/business-requests${query}`);
    return { outcome: 'ok', requests };
  } catch (err) {
    return { outcome: listErrorOutcome(err) };
  }
}

export async function approveBusinessRequest(id: string): Promise<BusinessRequestActionResult> {
  try {
    const businessRequest = await request<BusinessRequestAdmin>(
      `/api/admin/business-requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST' },
    );
    return { outcome: 'ok', request: businessRequest };
  } catch (err) {
    return actionErrorResult(err);
  }
}

export async function rejectBusinessRequest(id: string, reviewerNote: string): Promise<BusinessRequestActionResult> {
  try {
    const businessRequest = await request<BusinessRequestAdmin>(
      `/api/admin/business-requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify({ reviewerNote }) },
    );
    return { outcome: 'ok', request: businessRequest };
  } catch (err) {
    return actionErrorResult(err);
  }
}
