/**
 * @fileoverview Reward state derivation and expiry-date conversion (CAR-202)
 * @module lib/rewardState
 *
 * @description
 * `RewardOut` (server/app/schemas/reward.py) carries no `state`/`status`
 * field — a business's reward is "active", "sold out" or "expired" only as
 * an interpretation of `isActive`, `expiresAt`, `stock` and `available`. This
 * is the one place that interpretation happens, so the list page and its
 * tests can never define "sold out" differently than each other.
 */
import type { Reward } from './api/rewards';
import { normalizeBusinessCategory } from './businessCategory';
import type { TranslationMap } from '@/i18n/types';

export type RewardState = 'inactive' | 'expired' | 'soldOut' | 'active';

// The one place a reward's category becomes a `rewards.category*` i18n key.
// Shared by the list page (rendering data that may hold a legacy/unrecognized
// value) and the create/edit form (rendering the fixed option list, which is
// always a real BusinessCategory) so the two can never label the same
// category differently.
export function categoryTranslationKey(category: string): keyof TranslationMap['rewards'] {
  const normalized = normalizeBusinessCategory(category);
  return `category${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` as keyof TranslationMap['rewards'];
}

// A legacy reward's English side may be `null`, absent, empty, or
// whitespace-only — all of these mean "not really there" for display
// purposes, never a title/description literally made of blank space. Falls
// back to the other language's value rather than rendering nothing.
function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

export function localizedRewardText(primary: string | null | undefined, fallback: string | null | undefined): string {
  if (!isBlank(primary)) return primary as string;
  if (!isBlank(fallback)) return fallback as string;
  return '';
}

export function isArchived(reward: Reward): boolean {
  return reward.archivedAt !== null;
}

// Precedence, most definitive first: a manual deactivation says more than a
// campaign that happens to have run out of time or stock; a time-based
// expiry is decided independently of whatever stock is left, so it is
// checked before stock. Only a reward that fails every disqualifying check
// is "active".
export function getRewardState(reward: Reward, now: Date = new Date()): RewardState {
  if (!reward.isActive) return 'inactive';
  if (reward.expiresAt !== null && new Date(reward.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (reward.stock !== null && (reward.available ?? 0) <= 0) return 'soldOut';
  return 'active';
}

// A date-only `<input type="date">` value ("YYYY-MM-DD") has no timezone of
// its own. Parsing it with `new Date(dateStr)` reads it as UTC midnight,
// which renders as the previous day in any timezone behind UTC — the classic
// off-by-one. Building the Date from its parts instead treats the string as
// the browser's local calendar date, and the boundary is pushed to the last
// instant of that day so "expires 2026-08-29" still lets a redemption happen
// any time during the 29th.
export function expiryDateInputToIso(dateInput: string): string {
  const [year, month, day] = dateInput.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

// The inverse, for pre-filling the edit form from a server ISO timestamp.
// Reads the local calendar date the same way `expiryDateInputToIso` writes
// it, so a round trip through the form never shifts the date by a day.
export function isoToExpiryDateInput(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
