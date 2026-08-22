import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, ApiError } from './client';
import { setSession } from '@/lib/auth/session';
import { attemptRefresh } from '@/lib/auth/refresh';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/auth/refresh', () => ({ attemptRefresh: vi.fn() }));

const USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: null,
  businessCategory: null,
};

function jsonResponse(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('request', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('attaches the in-memory access token as a bearer header', async () => {
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }, 200));

    await request('/api/business/rewards');

    const init = vi.mocked(fetch).mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('sends no Authorization header when there is no session', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }, 200));

    await request('/api/business/rewards');

    const init = vi.mocked(fetch).mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('retries exactly once, with the new token, after a successful silent refresh', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.mocked(attemptRefresh).mockImplementation(async () => {
      setSession({ accessToken: 'tok-2', user: USER });
      return 'ok';
    });

    const result = await request<{ ok: boolean }>('/api/business/rewards');

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    const retryInit = vi.mocked(fetch).mock.calls[1][1];
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('fails without a second retry when the refresh is genuinely rejected', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    vi.mocked(attemptRefresh).mockResolvedValue('rejected');

    await expect(request('/api/business/rewards')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails without a second retry when the refresh only fails transiently — not a truthy-string bug', async () => {
    // `attemptRefresh` resolves to a string in every case; a plain truthy
    // check on the outcome would retry after 'transient' too, since any
    // non-empty string is truthy in JS. This pins the explicit `=== 'ok'`.
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    vi.mocked(attemptRefresh).mockResolvedValue('transient');

    await expect(request('/api/business/rewards')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-401 failure as an ApiError carrying the status', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'nope' }, 403));

    await expect(request('/api/business/rewards')).rejects.toMatchObject({ status: 403, message: 'nope' });
  });

  it('carries a structured detail.code through to the thrown ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'VOUCHER_EXPIRED', message: 'Voucher expired' } }, 409),
    );

    await expect(request('/api/business/vouchers/ABC/redeem')).rejects.toMatchObject({
      status: 409,
      code: 'VOUCHER_EXPIRED',
      message: 'Voucher expired',
    });
  });

  it('leaves code undefined for a plain string detail — no discriminator to invent', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'nope' }, 403));

    await expect(request('/api/business/rewards')).rejects.toMatchObject({ code: undefined });
  });

  it('reads retryAfterSeconds off the Retry-After header on a 429', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: 'Too many attempts.' }, 429, { 'Retry-After': '42' }),
    );

    await expect(request('/api/business/vouchers/ABC')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 42 });
  });

  it('leaves retryAfterSeconds undefined when the header is absent', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'nope' }, 403));

    await expect(request('/api/business/rewards')).rejects.toMatchObject({ retryAfterSeconds: undefined });
  });

  it('leaves retryAfterSeconds undefined when the header is present but not a number', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'nope' }, 429, { 'Retry-After': 'soon' }));

    await expect(request('/api/business/rewards')).rejects.toMatchObject({ status: 429, retryAfterSeconds: undefined });
  });

  it('surfaces a fetch that never reached the server as an ApiError with status 0', async () => {
    // Same status-0 convention as `lib/auth/authApi.ts` — no real HTTP
    // response, so there is nothing else to report a status from.
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(request('/api/business/rewards')).rejects.toMatchObject({ status: 0, message: 'Network error' });
  });
});
