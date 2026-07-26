/**
 * Reward pricing — display side.
 *
 * The server decides what a driver pays: it applies the level discount in
 * `services/rewards.py::effective_cost` and sends the result as
 * `effectiveCostPoints`. This module only picks the right number to show.
 *
 * It exists so that every screen picks the *same* number. A card showing the
 * discounted price while the confirmation sheet shows the list price is the
 * same class of bug as #29 — two prices for one purchase.
 *
 * Never derive a discount here. If `effectiveCostPoints` is missing, the
 * reward came from a context with no viewer (the entry embedded in a voucher),
 * and the list price is the only honest thing to show.
 */

import type { Reward } from '@/types';

export function rewardPrice(reward: Pick<Reward, 'costPoints' | 'effectiveCostPoints'>): number {
  return reward.effectiveCostPoints ?? reward.costPoints;
}

/** True when the driver's level actually takes something off this reward. */
export function isDiscounted(reward: Pick<Reward, 'costPoints' | 'effectiveCostPoints'>): boolean {
  return rewardPrice(reward) < reward.costPoints;
}
