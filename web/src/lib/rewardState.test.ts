import { describe, it, expect } from 'vitest';
import {
  getRewardState,
  isArchived,
  expiryDateInputToIso,
  isoToExpiryDateInput,
  categoryTranslationKey,
  localizedRewardText,
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

  it('is not expired while the expiry timestamp is still in the future', () => {
    expect(getRewardState(reward({ expiresAt: '2026-06-15T12:00:00.001Z' }), NOW)).toBe('active');
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
