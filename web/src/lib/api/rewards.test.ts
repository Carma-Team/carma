import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listRewards, createReward, updateReward, retireReward, type Reward, type RewardPayload } from './rewards';
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

const REWARD: Reward = {
  id: 'r1',
  businessId: 'b1',
  business: 'Biz',
  businessHe: null,
  titleHe: 'שובר',
  titleEn: 'Voucher',
  descriptionHe: 'תיאור',
  descriptionEn: 'Description',
  category: 'food',
  costPoints: 10,
  imageIcon: 'gift-outline',
  isActive: true,
  archivedAt: null,
  stock: 5,
  available: 3,
  expiresAt: '2030-01-01T21:59:59.999Z',
};

const PAYLOAD: RewardPayload = {
  titleHe: 'שובר',
  titleEn: 'Voucher',
  descriptionHe: 'תיאור',
  descriptionEn: 'Description',
  category: 'food',
  costPoints: 10,
  stock: null,
  expiresAt: '2030-01-01T21:59:59.999Z',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

describe('rewards', () => {
  beforeEach(() => {
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(attemptRefresh).mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it('listRewards issues a GET against /api/business/rewards and resolves ok', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ rewards: [REWARD] }, 200));

    await expect(listRewards()).resolves.toEqual({ outcome: 'ok', rewards: [REWARD] });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/rewards')).toBe(true);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('maps a load failure to network_error rather than rejecting', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listRewards()).resolves.toEqual({ outcome: 'network_error' });
  });

  it('maps an unexpected server 403 on list to forbidden, without crashing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Forbidden' }, 403));

    await expect(listRewards()).resolves.toEqual({ outcome: 'forbidden' });
  });

  // ── create ───────────────────────────────────────────────────────────────

  it('createReward issues a POST against /api/business/rewards with the expected payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reward: REWARD }, 200));

    await expect(createReward(PAYLOAD)).resolves.toEqual({ outcome: 'ok', reward: REWARD });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/rewards')).toBe(true);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(PAYLOAD);
  });

  it('sends a blank allocation as an explicit null, never omitted', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reward: REWARD }, 200));

    await createReward({ ...PAYLOAD, stock: null });

    const init = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(init?.body as string);
    expect('stock' in body).toBe(true);
    expect(body.stock).toBeNull();
  });

  it('sends a numeric allocation as that integer', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reward: REWARD }, 200));

    await createReward({ ...PAYLOAD, stock: 25 });

    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(init?.body as string).stock).toBe(25);
  });

  it('sends a blank expiry as an explicit null, never omitted', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reward: REWARD }, 200));

    await createReward({ ...PAYLOAD, expiresAt: null });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect('expiresAt' in body).toBe(true);
    expect(body.expiresAt).toBeNull();
  });

  // ── edit ─────────────────────────────────────────────────────────────────

  it('updateReward issues a PATCH against /api/business/rewards/{id} with the expected payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reward: REWARD }, 200));

    await expect(updateReward('r1', PAYLOAD)).resolves.toEqual({ outcome: 'ok', reward: REWARD });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/rewards/r1')).toBe(true);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual(PAYLOAD);
  });

  // ── retire ───────────────────────────────────────────────────────────────

  it('retireReward issues a DELETE against /api/business/rewards/{id} and resolves ok on 204', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(retireReward('r1')).resolves.toEqual({ outcome: 'ok' });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith('/api/business/rewards/r1')).toBe(true);
    expect(init?.method).toBe('DELETE');
  });

  it('retireReward resolves to an error outcome rather than throwing, keeping the reward visible on failure', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Internal server error' }, 500));

    await expect(retireReward('r1')).resolves.toEqual({ outcome: 'unexpected_error' });
  });

  // ── auth reuse ───────────────────────────────────────────────────────────

  it('attaches the authenticated business session as a bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ rewards: [] }, 200));

    await listRewards();

    const init = vi.mocked(fetch).mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });
});
