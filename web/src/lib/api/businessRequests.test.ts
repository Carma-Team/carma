import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  approveBusinessRequest,
  listBusinessRequests,
  rejectBusinessRequest,
  type BusinessRequestAdmin,
} from './businessRequests';
import { setSession } from '@/lib/auth/session';
import { attemptRefresh } from '@/lib/auth/refresh';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/auth/refresh', () => ({ attemptRefresh: vi.fn() }));

const ADMIN: AuthUser = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  businessId: null,
  businessCategory: null,
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

const REQUEST: BusinessRequestAdmin = {
  id: 'r1',
  status: 'pending',
  name: 'Aroma',
  nameHe: 'ארומה',
  category: 'food',
  locationLat: 32.0648,
  locationLng: 34.7748,
  address: 'Rothschild 1, Tel Aviv',
  registrationNumber: 'REG-1',
  contactPerson: 'Dana Cohen',
  phone: '+972501234567',
  createdAt: '2026-08-27T00:00:00Z',
  reviewedAt: null,
  reviewerNote: null,
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

describe('listBusinessRequests', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-admin', user: ADMIN });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('lists requests with no status query when no filter is given', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ requests: [REQUEST] }, 200));

    const result = await listBusinessRequests();

    expect(result).toEqual({ outcome: 'ok', requests: [REQUEST] });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/admin/business-requests');
    expect(url).not.toContain('?status');
  });

  it('sends the status filter as a query param, matching the server\'s alias', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ requests: [] }, 200));

    await listBusinessRequests('pending');

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/admin/business-requests?status=pending');
  });

  it('reports forbidden on a 403 (a non-admin token, or a stale-role token the server re-checked)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Admin account required' }, 403));

    await expect(listBusinessRequests()).resolves.toEqual({ outcome: 'forbidden' });
  });

  it('reports a network failure distinctly', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listBusinessRequests()).resolves.toEqual({ outcome: 'network_error' });
  });
});

describe('approveBusinessRequest', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-admin', user: ADMIN });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('posts to the approve endpoint and returns the server-returned request as authoritative', async () => {
    const approved = { ...REQUEST, status: 'approved' as const, reviewedAt: '2026-08-28T00:00:00Z' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(approved, 200));

    const result = await approveBusinessRequest('r1');

    expect(result).toEqual({ outcome: 'ok', request: approved });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/admin/business-requests/r1/approve');
    expect(init?.method).toBe('POST');
  });

  it('surfaces the server\'s structured conflict code and message on a 409 (e.g. already decided elsewhere)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'INVALID_STATE_TRANSITION', message: 'This request was already rejected' } }, 409),
    );

    await expect(approveBusinessRequest('r1')).resolves.toEqual({
      outcome: 'conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This request was already rejected',
    });
  });

  it('reports not_found on a 404 (the request row no longer exists)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Business join request not found' }, 404));

    await expect(approveBusinessRequest('missing')).resolves.toEqual({ outcome: 'not_found' });
  });

  it('reports forbidden on a 403', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Admin account required' }, 403));

    await expect(approveBusinessRequest('r1')).resolves.toEqual({ outcome: 'forbidden' });
  });
});

describe('rejectBusinessRequest', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-admin', user: ADMIN });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the reviewer note under the field name the CAR-77 API expects', async () => {
    const rejected = { ...REQUEST, status: 'rejected' as const, reviewerNote: 'Missing documents' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(rejected, 200));

    const result = await rejectBusinessRequest('r1', 'Missing documents');

    expect(result).toEqual({ outcome: 'ok', request: rejected });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/admin/business-requests/r1/reject');
    expect(JSON.parse(init?.body as string)).toEqual({ reviewerNote: 'Missing documents' });
  });

  it('surfaces a conflict for a request already decided (e.g. approve -> reject is refused)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'INVALID_STATE_TRANSITION', message: 'This request was already approved' } }, 409),
    );

    await expect(rejectBusinessRequest('r1', 'note')).resolves.toEqual({
      outcome: 'conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This request was already approved',
    });
  });
});
