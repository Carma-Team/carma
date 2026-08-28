import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitJoinRequest, getJoinRequestStatus, type JoinRequestPayload } from './businessRegistration';
import { getSession } from '@/lib/auth/session';

function jsonResponse(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

const PAYLOAD: JoinRequestPayload = {
  name: 'Aroma',
  nameHe: 'ארומה',
  category: 'food',
  address: 'Rothschild 1, Tel Aviv',
  locationLat: 32.0648,
  locationLng: 34.7748,
  registrationNumber: '123456789',
  contactPerson: 'Dana Cohen',
};

describe('submitJoinRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('submits the address-only payload with the given access token, never the shared session store', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'r1', status: 'pending', createdAt: '2026-08-27T00:00:00Z' }, 201));

    const result = await submitJoinRequest(PAYLOAD, 'tok-otp-1');

    expect(result).toEqual({ outcome: 'ok', id: 'r1', createdAt: '2026-08-27T00:00:00Z' });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/business/join-requests');
    expect(JSON.parse(init?.body as string)).toEqual(PAYLOAD);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-otp-1');
    // The whole point of taking the token as a parameter: this call must
    // never touch (read or write) the app-wide session singleton.
    expect(getSession()).toBeNull();
  });

  it('sends the geocode-derived coordinates alongside the address text', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'r1', status: 'pending', createdAt: '2026-08-27T00:00:00Z' }, 201));

    await submitJoinRequest(PAYLOAD, 'tok-otp-1');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.locationLat).toBe(32.0648);
    expect(body.locationLng).toBe(34.7748);
    expect(body.address).toBe('Rothschild 1, Tel Aviv');
  });

  it('reports a duplicate submission as already_pending, not a generic error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'You already have a pending business request' }, 409));

    await expect(submitJoinRequest(PAYLOAD, 'tok-otp-1')).resolves.toEqual({ outcome: 'already_pending' });
  });

  it('reports a network failure distinctly', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(submitJoinRequest(PAYLOAD, 'tok-otp-1')).resolves.toEqual({ outcome: 'network_error' });
  });
});

describe('getJoinRequestStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns none when no request has ever been submitted, using the given token only', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'none', createdAt: null, reviewerNote: null }, 200));

    await expect(getJoinRequestStatus('tok-otp-2')).resolves.toEqual({
      outcome: 'ok',
      status: { status: 'none', createdAt: null, reviewerNote: null },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-otp-2');
    expect(getSession()).toBeNull();
  });
});
