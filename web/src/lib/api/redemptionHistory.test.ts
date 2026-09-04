import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listRedemptionHistory, type RedemptionHistoryEntry } from './redemptionHistory';
import { setSession } from '@/lib/auth/session';
import { attemptRefresh } from '@/lib/auth/refresh';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/auth/refresh', () => ({ attemptRefresh: vi.fn() }));

const USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
};

const ENTRY: RedemptionHistoryEntry = {
  id: 'red-1',
  reward: { id: 'r1', titleHe: 'שובר קפה', titleEn: 'Coffee voucher', imageIcon: 'gift-outline', category: 'food' },
  status: 'used',
  pointsCost: 10,
  createdAt: '2026-08-01T10:00:00Z',
  settledAt: '2026-08-01T10:05:00Z',
  consumedByUserId: 'staff-1',
  consumedByName: 'Dana Levi',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

describe('redemptionHistory', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('issues a GET against /api/business/redemptions with no query when no filters are given', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ redemptions: [ENTRY], liveVoucherCount: 2, nextCursor: null }, 200));

    await expect(listRedemptionHistory({ statuses: [] })).resolves.toEqual({
      outcome: 'ok',
      redemptions: [ENTRY],
      liveVoucherCount: 2,
      nextCursor: null,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/redemptions')).toBe(true);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('serializes multiple statuses as one comma-separated `status` param', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ redemptions: [], liveVoucherCount: 0, nextCursor: null }, 200));

    await listRedemptionHistory({ statuses: ['used', 'expired', 'cancelled'] });

    const [url] = vi.mocked(fetch).mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1] ?? '');
    expect(params.get('status')).toBe('used,expired,cancelled');
  });

  it('sends rewardId, from, to, cursor and limit as separate query params when given', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ redemptions: [], liveVoucherCount: 0, nextCursor: null }, 200));

    await listRedemptionHistory({
      statuses: ['used'],
      rewardId: 'r1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
      cursor: 'abc123',
      limit: 20,
    });

    const [url] = vi.mocked(fetch).mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1] ?? '');
    expect(params.get('rewardId')).toBe('r1');
    expect(params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-01-31T23:59:59.999Z');
    expect(params.get('cursor')).toBe('abc123');
    expect(params.get('limit')).toBe('20');
  });

  it('omits null/undefined filters rather than sending empty query params', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ redemptions: [], liveVoucherCount: 0, nextCursor: null }, 200));

    await listRedemptionHistory({ statuses: ['used'], rewardId: null, from: null, to: null, cursor: null });

    const [url] = vi.mocked(fetch).mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1] ?? '');
    expect(params.has('rewardId')).toBe(false);
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
    expect(params.has('cursor')).toBe(false);
  });

  it('maps a network failure to network_error rather than rejecting', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listRedemptionHistory({ statuses: ['used'] })).resolves.toEqual({ outcome: 'network_error' });
  });

  it('maps a 403 to forbidden — a CASHIER hitting the endpoint directly', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Forbidden' }, 403));

    await expect(listRedemptionHistory({ statuses: ['used'] })).resolves.toEqual({ outcome: 'forbidden' });
  });

  it('maps any other failure to unexpected_error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Bad request' }, 400));

    await expect(listRedemptionHistory({ statuses: ['used'] })).resolves.toEqual({ outcome: 'unexpected_error' });
  });
});
