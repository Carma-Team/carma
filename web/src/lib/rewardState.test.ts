import { describe, it, expect } from 'vitest';
import {
  getRewardState,
  isArchived,
  isEnded,
  matchesTab,
  expiryDateInputToIso,
  isoToExpiryDateInput,
  categoryTranslationKey,
  localizedRewardText,
  type RewardTab,
} from './rewardState';
import type { Reward } from './api/rewards';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function reward(overrides: Partial<Reward> = {}): Reward {
  return {
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
    stock: null,
    available: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('getRewardState', () => {
  it('is active when nothing disqualifies it', () => {
    expect(getRewardState(reward(), NOW)).toBe('active');
  });

  it('is active for a limited reward that still has stock remaining', () => {
    expect(getRewardState(reward({ stock: 5, available: 1 }), NOW)).toBe('active');
  });

  it('is unlimited-active regardless of available, since stock is null', () => {
    expect(getRewardState(reward({ stock: null, available: null }), NOW)).toBe('active');
  });

  it('is soldOut once a limited reward has zero remaining', () => {
    expect(getRewardState(reward({ stock: 5, available: 0 }), NOW)).toBe('soldOut');
  });

  it('is expired once the expiry timestamp has passed', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-15T11:59:59.999Z' }), NOW)).toBe('expired');
  });

  it('is not expired while the expiry timestamp is still in the future, and far enough out to not be ending soon', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-24T12:00:00.001Z' }), NOW)).toBe('active');
  });

  // ── endingSoon (CAR-339): a badge nuance within "still active", not a
  // persisted status — see the approved design's lifecycle note. ─────────

  it('is endingSoon inside the 7-day window before expiry', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-22T12:00:00.000Z' }), NOW)).toBe('endingSoon');
  });

  it('is active, not endingSoon, just outside the 7-day window', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-22T12:00:00.001Z' }), NOW)).toBe('active');
  });

  it('is expired, not endingSoon, once the boundary is crossed the other way', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-15T12:00:00.000Z' }), NOW)).toBe('expired');
  });

  it('prefers soldOut over endingSoon once stock also runs out', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-22T12:00:00.000Z', stock: 5, available: 0 }), NOW)).toBe('soldOut');
  });

  it('prefers inactive over endingSoon when a business paused a reward that is also about to expire', () => {
    expect(getRewardState(reward({ isActive: false, expiresAt: '2026-06-22T12:00:00.000Z' }), NOW)).toBe('inactive');
  });

  it('is inactive when isActive is false, regardless of stock or expiry', () => {
    expect(getRewardState(reward({ isActive: false, stock: 5, available: 3 }), NOW)).toBe('inactive');
  });

  // Precedence: a manual deactivation outranks an expiry, which outranks a
  // stock exhaustion — each condition is checked only once the more
  // definitive ones above it have been ruled out.
  it('reports inactive over expired when both conditions apply', () => {
    expect(getRewardState(reward({ isActive: false, expiresAt: '2020-01-01T00:00:00.000Z' }), NOW)).toBe('inactive');
  });

  it('reports expired over soldOut when both conditions apply', () => {
    expect(
      getRewardState(reward({ expiresAt: '2020-01-01T00:00:00.000Z', stock: 5, available: 0 }), NOW),
    ).toBe('expired');
  });
});

describe('isArchived', () => {
  it('is false when archivedAt is null', () => {
    expect(isArchived(reward({ archivedAt: null }))).toBe(false);
  });

  it('is true once archivedAt is set, regardless of isActive', () => {
    expect(isArchived(reward({ archivedAt: '2026-01-01T00:00:00.000Z', isActive: true }))).toBe(true);
  });
});

describe('matchesTab', () => {
  const ALL_TABS: RewardTab[] = ['all', 'active', 'paused', 'ended', 'archived'];

  function tabsMatching(r: Reward): RewardTab[] {
    return ALL_TABS.filter((tab) => matchesTab(r, tab, NOW));
  }

  it('sorts a plain active reward into all and active only', () => {
    expect(tabsMatching(reward())).toEqual(['all', 'active']);
  });

  it('sorts a paused reward into all and paused only', () => {
    expect(tabsMatching(reward({ isActive: false }))).toEqual(['all', 'paused']);
  });

  it('sorts an expired reward into all and ended only, even while still isActive', () => {
    expect(tabsMatching(reward({ expiresAt: '2020-01-01T00:00:00.000Z' }))).toEqual(['all', 'ended']);
  });

  it('sorts a paused-and-expired reward into ended, not paused — expiry outranks pause for this bucket', () => {
    expect(isEnded(reward({ isActive: false, expiresAt: '2020-01-01T00:00:00.000Z' }), NOW)).toBe(true);
    expect(tabsMatching(reward({ isActive: false, expiresAt: '2020-01-01T00:00:00.000Z' }))).toEqual(['all', 'ended']);
  });

  it('sorts an archived reward into archived only, excluded from all', () => {
    expect(tabsMatching(reward({ archivedAt: '2026-01-01T00:00:00.000Z' }))).toEqual(['archived']);
  });

  it('excludes a sold-out-but-not-expired reward from ended', () => {
    expect(tabsMatching(reward({ stock: 5, available: 0 }))).toEqual(['all', 'active']);
  });
});

describe('expiry date conversion', () => {
  it('converts a date-input value to the last instant of that local calendar day', () => {
    const iso = expiryDateInputToIso('2026-08-29');
    const parsed = new Date(iso);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7); // August, 0-indexed
    expect(parsed.getDate()).toBe(29);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
  });

  it('round-trips through isoToExpiryDateInput without shifting the date', () => {
    const iso = expiryDateInputToIso('2026-01-01');
    expect(isoToExpiryDateInput(iso)).toBe('2026-01-01');
  });

  it('round-trips a year-end date without shifting into the next year', () => {
    const iso = expiryDateInputToIso('2026-12-31');
    expect(isoToExpiryDateInput(iso)).toBe('2026-12-31');
  });
});

describe('categoryTranslationKey', () => {
  it('builds the rewards.category* key for each recognized category', () => {
    expect(categoryTranslationKey('fuel')).toBe('categoryFuel');
    expect(categoryTranslationKey('food')).toBe('categoryFood');
    expect(categoryTranslationKey('other')).toBe('categoryOther');
  });

  it('falls back to categoryOther for an unrecognized or legacy category value', () => {
    expect(categoryTranslationKey('some-future-category')).toBe('categoryOther');
  });
});

describe('localizedRewardText', () => {
  it('uses the primary value when it is present', () => {
    expect(localizedRewardText('Free coffee', 'קפה חינם')).toBe('Free coffee');
  });

  it('falls back to the other language when the primary is null', () => {
    expect(localizedRewardText(null, 'קפה חינם')).toBe('קפה חינם');
  });

  it('falls back to the other language when the primary is undefined', () => {
    expect(localizedRewardText(undefined, 'קפה חינם')).toBe('קפה חינם');
  });

  it('falls back to the other language when the primary is an empty string', () => {
    expect(localizedRewardText('', 'קפה חינם')).toBe('קפה חינם');
  });

  it('falls back to the other language when the primary is whitespace-only', () => {
    expect(localizedRewardText('   ', 'קפה חינם')).toBe('קפה חינם');
  });

  it('returns an empty string, never throws, when both languages are missing', () => {
    expect(localizedRewardText(null, undefined)).toBe('');
  });
});
