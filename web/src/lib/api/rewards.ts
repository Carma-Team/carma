/**
 * @fileoverview Business-side reward catalog management (CAR-202)
 * @module lib/api/rewards
 *
 * @description
 * Wraps `GET/POST/PATCH/DELETE /api/business/rewards` on top of
 * `lib/api/client.ts`'s `request()`. Follows the same never-throw-for-an-
 * expected-failure convention as `lib/api/vouchers.ts`: each function
 * resolves to a closed result union the caller switches on.
 */
import { ApiError, request } from './client';

// The one TypeScript mirror of the server's `RewardOut`
// (server/app/schemas/reward.py) — `lib/api/vouchers.ts` imports this rather
// than defining its own, since a voucher only ever embeds a reward snapshot.
export type Reward = {
  id: string;
  businessId: string;
  business: string;
  businessHe: string | null;
  titleHe: string;
  titleEn: string | null;
  descriptionHe: string | null;
  descriptionEn: string | null;
  category: string;
  costPoints: number;
  imageIcon: string;
  isActive: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  stock: number | null;
  available: number | null;
  expiresAt: string | null;
};

// What the form actually collects and the server actually accepts (a subset
// of BusinessRewardIn/BusinessRewardPatchIn — image_icon and is_active stay
// server defaults, out of this ticket's scope). `stock: null` is sent
// explicitly for "unlimited", never omitted — omitting a field from a PATCH
// body means "leave it as it was" server-side (`model_dump(exclude_unset=True)`
// in `services/business.py::update_reward`), so a blank allocation field must
// serialize to an explicit null to actually clear a previously-set stock.
export type RewardPayload = {
  titleHe: string;
  titleEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  category: string;
  costPoints: number;
  stock: number | null;
  // null is a real, first-class value here (matches the server's
  // `expires_at: datetime | None` — no expiry at all), sent explicitly for
  // the same reason `stock: null` is: omitting the key from a PATCH body
  // means "leave it as it was", not "clear it".
  expiresAt: string | null;
};

export type RewardsListResult =
  | { outcome: 'ok'; rewards: Reward[] }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type RewardMutationResult =
  | { outcome: 'ok'; reward: Reward }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type RetireRewardResult =
  | { outcome: 'ok' }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type TrashRewardResult =
  | { outcome: 'ok' }
  | { outcome: 'has_live_vouchers' }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type RewardLifecycleResult =
  | { outcome: 'ok' }
  | { outcome: 'forbidden' }
  | { outcome: 'network_error' }
  | { outcome: 'unexpected_error' };

export type LiveVoucherCountResult =
  | { outcome: 'ok'; liveVouchers: number }
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

export async function listRewards(): Promise<RewardsListResult> {
  try {
    const { rewards } = await request<{ rewards: Reward[] }>('/api/business/rewards');
    return { outcome: 'ok', rewards };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

export async function createReward(payload: RewardPayload): Promise<RewardMutationResult> {
  try {
    const { reward } = await request<{ reward: Reward }>('/api/business/rewards', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', reward };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

export async function updateReward(rewardId: string, payload: RewardPayload): Promise<RewardMutationResult> {
  try {
    const { reward } = await request<{ reward: Reward }>(`/api/business/rewards/${encodeURIComponent(rewardId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return { outcome: 'ok', reward };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

// Pause/resume (CAR-339) — a partial PATCH of just `isActive`, the one field
// `RewardPayload` deliberately omits (see its own comment). The server's
// `BusinessRewardPatchIn` applies only the keys actually sent
// (`model_dump(exclude_unset=True)`), so this never touches the reward's
// other fields.
export async function setRewardActive(rewardId: string, isActive: boolean): Promise<RewardMutationResult> {
  try {
    const { reward } = await request<{ reward: Reward }>(`/api/business/rewards/${encodeURIComponent(rewardId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    return { outcome: 'ok', reward };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

export async function retireReward(rewardId: string): Promise<RetireRewardResult> {
  try {
    await request<undefined>(`/api/business/rewards/${encodeURIComponent(rewardId)}`, { method: 'DELETE' });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

// Active or Archive -> Trash. The server 409s with this code while a
// live voucher is outstanding — surfaced as its own outcome rather than
// folded into 'unexpected_error' so the confirm dialog can show the same
// live-voucher framing the archive dialog already does.
export async function trashReward(rewardId: string): Promise<TrashRewardResult> {
  try {
    await request<undefined>(`/api/business/rewards/${encodeURIComponent(rewardId)}/trash`, { method: 'POST' });
    return { outcome: 'ok' };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'REWARD_HAS_LIVE_VOUCHERS') return { outcome: 'has_live_vouchers' };
    return { outcome: errorOutcome(err) };
  }
}

// Trash -> Archive only, never straight to Active — see the model's own
// comment (server/app/models/reward.py) for why restoring stops there.
export async function restoreRewardFromTrash(rewardId: string): Promise<RewardLifecycleResult> {
  try {
    await request<undefined>(`/api/business/rewards/${encodeURIComponent(rewardId)}/restore`, { method: 'POST' });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

// Archive -> Active — the one explicit action that puts a reward back in the
// catalog and marketplace. Never available for a still-trashed reward; that
// one goes through restoreRewardFromTrash first.
export async function reactivateReward(rewardId: string): Promise<RewardLifecycleResult> {
  try {
    await request<undefined>(`/api/business/rewards/${encodeURIComponent(rewardId)}/reactivate`, { method: 'POST' });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

// Trash -> gone. Only ever reachable from the Trash view — irreversible from
// the business's own perspective even though the server may keep a tombstoned
// row for historical joins (server/app/services/business.py).
export async function deleteRewardPermanently(rewardId: string): Promise<RewardLifecycleResult> {
  try {
    await request<undefined>(`/api/business/rewards/${encodeURIComponent(rewardId)}/permanent`, { method: 'DELETE' });
    return { outcome: 'ok' };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}

// Mirrors `LiveVoucherCountOut` (server/app/schemas/reward.py) — the count the
// retire confirmation dialog must show before a business can actually retire
// a reward with live vouchers outstanding.
export async function getLiveVoucherCount(rewardId: string): Promise<LiveVoucherCountResult> {
  try {
    const { liveVouchers } = await request<{ liveVouchers: number }>(
      `/api/business/rewards/${encodeURIComponent(rewardId)}/live-vouchers`,
    );
    return { outcome: 'ok', liveVouchers };
  } catch (err) {
    return { outcome: errorOutcome(err) };
  }
}
