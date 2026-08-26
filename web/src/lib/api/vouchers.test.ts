import { describe, it, expect, vi, beforeEach } from 'vitest';
import { peekVoucher, consumeVoucher, normalizeVoucherCode } from './vouchers';
import type { Voucher } from './vouchers';
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
  businessName: null,
  businessNameHe: null,
};

const REWARD = {
  id: 'r1',
  businessId: 'b1',
  business: 'Biz',
  businessHe: null,
  titleHe: 'שובר',
  titleEn: null,
  descriptionHe: 'תיאור',
  descriptionEn: null,
  category: 'food',
  costPoints: 10,
  imageIcon: 'gift-outline',
  isActive: true,
  archivedAt: null,
  stock: null,
  available: null,
  expiresAt: null,
};

const VOUCHER: Voucher = {
  id: 'v1',
  rewardId: 'r1',
  code: 'ABC123XYZ0',
  qrData: 'ABC123XYZ0',
  status: 'pending',
  isUsed: false,
  expiresAt: '2030-01-01T00:00:00Z',
  redeemedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  pointsCost: 10,
  reward: REWARD,
};

function jsonResponse(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('vouchers', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  // ── success ──────────────────────────────────────────────────────────────

  it('peekVoucher resolves ok with the voucher on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'ok', voucher: VOUCHER });
  });

  it('consumeVoucher resolves ok with the voucher on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'ok', voucher: VOUCHER });
  });

  // ── expected failures, as results rather than thrown errors ────────────────

  it('maps 404 to not_valid_here — no distinction between unknown and another business’s code', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Voucher not found' }, 404));

    await expect(peekVoucher('NOSUCHCODE')).resolves.toEqual({ outcome: 'not_valid_here' });
  });

  it('maps a 409 VOUCHER_ALREADY_USED code to already_used', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'VOUCHER_ALREADY_USED', message: 'Voucher already used' } }, 409),
    );

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'already_used' });
  });

  it('maps a 409 VOUCHER_EXPIRED code to expired', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'VOUCHER_EXPIRED', message: 'Voucher expired' } }, 409),
    );

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'expired' });
  });

  it('never distinguishes already_used from expired by sniffing message text', async () => {
    // A 409 whose message happens to read "already used" but carries no
    // recognized code — the client must not fall back to text matching.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: { message: 'Voucher already used' } }, 409));

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
  });

  it('maps a 409 with an explicit but unrecognized code to unexpected_error, not a guess', async () => {
    // A concrete third code, not just a missing one — pins that only the two
    // known VOUCHER_* codes are ever trusted, not "any code at all".
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: { code: 'SOME_FUTURE_CONFLICT', message: 'Voucher busy' } }, 409),
    );

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
  });

  it('maps 429 to rate_limited and carries Retry-After through, typed', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Too many attempts.' }, 429, { 'Retry-After': '42' }));

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'rate_limited', retryAfterSeconds: 42 });
  });

  it('falls back to a null retryAfterSeconds when the header is missing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Too many attempts.' }, 429));

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'rate_limited', retryAfterSeconds: null });
  });

  it('maps a fetch that never reached the server to network_error rather than rejecting', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'network_error' });
  });

  it('maps an unexpected status to unexpected_error rather than rejecting', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Internal server error' }, 500));

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
  });

  it('maps a response that reached the server but failed to parse to unexpected_error, not network_error', async () => {
    // The request succeeded — the body just isn't valid JSON. Conflating this
    // with a network failure would hide a real contract bug behind "you're
    // offline".
    vi.mocked(fetch).mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
  });

  // ── normalization ────────────────────────────────────────────────────────

  it('normalizes lowercase, spaces and hyphens before sending', () => {
    expect(normalizeVoucherCode('  abc-123 xyz0 ')).toBe('ABC123XYZ0');
  });

  it('rejects a non-ASCII leftover instead of case-folding it, same order as the server', () => {
    // Mirrors `server/core/security.py::normalise_voucher_code`: reject before
    // upper-casing, because case-folding is not length-preserving outside
    // ASCII (`ß` would otherwise expand to `SS`).
    expect(normalizeVoucherCode('ßMPQRSTVW')).toBe('');
  });

  it('sends the normalized code in the request path', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await peekVoucher('abc-123 xyz0');

    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url.endsWith('/api/business/vouchers/ABC123XYZ0')).toBe(true);
  });

  // ── method and path ──────────────────────────────────────────────────────

  it('peek issues a GET against /api/business/vouchers/{code}', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await peekVoucher('ABC123XYZ0');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/vouchers/ABC123XYZ0')).toBe(true);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('consume issues a POST against /api/business/vouchers/{code}/redeem', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await consumeVoucher('ABC123XYZ0');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/vouchers/ABC123XYZ0/redeem')).toBe(true);
    expect(init?.method).toBe('POST');
  });

  // ── authentication reuse ─────────────────────────────────────────────────

  it('attaches the authenticated business session as a bearer token, like any other business call', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ voucher: VOUCHER }, 200));

    await peekVoucher('ABC123XYZ0');

    const init = vi.mocked(fetch).mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('goes through the shared 401-refresh-retry contract rather than bypassing it', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ voucher: VOUCHER }, 200));
    vi.mocked(attemptRefresh).mockImplementation(async () => {
      setSession({ accessToken: 'tok-2', user: USER });
      return 'ok';
    });

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'ok', voucher: VOUCHER });
    expect(fetch).toHaveBeenCalledTimes(2);
    const retryInit = vi.mocked(fetch).mock.calls[1][1];
    expect((retryInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('resolves to unexpected_error, without looping, when the shared refresh is rejected', async () => {
    // The session is genuinely dead — `attemptRefresh` already cleared it.
    // vouchers.ts is not the place that decides what happens to a dead
    // session (that's the app's auth shell); it just must not retry forever
    // or throw a raw exception over it.
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    vi.mocked(attemptRefresh).mockResolvedValue('rejected');

    await expect(peekVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves to unexpected_error, without looping, when the shared refresh only fails transiently', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    vi.mocked(attemptRefresh).mockResolvedValue('transient');

    await expect(consumeVoucher('ABC123XYZ0')).resolves.toEqual({ outcome: 'unexpected_error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
