/**
 * @fileoverview Business-side redemption history (CAR-80)
 * @module lib/api/redemptionHistory
 *
 * @description
 * Wraps `GET /api/business/redemptions` (CAR-79) on top of `lib/api/client.ts`'s
 * `request()` — the server is the only source of truth for what "history"
 * means (USED/EXPIRED/CANCELLED, keyset-paged on `settledAt`/`id`); this file
 * only shapes its response into a result union the page switches on, the same
 * never-throw-for-an-expected-failure convention as `lib/api/rewards.ts`.
 */
import { ApiError, request } from './client';

export type RedemptionHistoryStatus = 'used' | 'expired' | 'cancelled';

// Mirrors `RewardSummaryOut` (server/app/schemas/reward.py) — just enough of
// a reward to show on a settled row, not the live-inventory fields `Reward`
// (lib/api/rewards.ts) carries.
export type RedemptionHistoryReward = {
  id: string;
  titleHe: string;
  titleEn: string | null;
  imageIcon: string;
  category: string;
};

// Mirrors `BusinessRedemptionOut` (server/app/schemas/redemption.py). No
// driver identifier anywhere — `consumedBy*` names the business staff member
// who scanned the voucher (CAR-75), never the driver who redeemed it.
export type RedemptionHistoryEntry = {
  id: string;
  reward: RedemptionHistoryReward;
  status: RedemptionHistoryStatus;
  pointsCost: number;
  createdAt: string;
  settledAt: string;
  consumedByUserId: string | null;
  consumedByName: string | null;
};

export type RedemptionHistoryFilters = {
  statuses: RedemptionHistoryStatus[];
  rewardId?: string | null;
  // ISO 8601 with a UTC offset — the server 400s on a naive value.
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  limit?: number;
};

export type RedemptionHistoryListResult =
  | { outcome: 'ok'; redemptions: RedemptionHistoryEntry[]; liveVoucherCount: number; nextCursor: string | null }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

function errorOutcome(err: unknown): 'forbidden' | 'network_error' | 'unexpected_error' {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'network_error';
    if (err.status === 403) return 'forbidden';
  }
  return 'unexpected_error';
}

export async function listRedemptionHistory(filters: RedemptionHistoryFilters): Promise<RedemptionHistoryListResult> {
  const params = new URLSearchParams();
  if (filters.statuses.length > 0) params.set('status', filters.statuses.join(','));
  if (filters.rewardId) params.set('rewardId', filters.rewardId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();

  try {
    const body = await request<{
      redemptions: RedemptionHistoryEntry[];
      liveVoucherCount: number;
      nextCursor: string | null;
    }>(`/api/business/redemptions${query ? `?${query}` : ''}`);
    return { outcome: 'ok', ...body };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}
