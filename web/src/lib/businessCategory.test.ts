import { describe, it, expect } from 'vitest';
import { BUSINESS_CATEGORIES, isBusinessCategory, normalizeBusinessCategory } from './businessCategory';

describe('isBusinessCategory', () => {
  it('accepts every value in BUSINESS_CATEGORIES', () => {
    for (const category of BUSINESS_CATEGORIES) {
      expect(isBusinessCategory(category)).toBe(true);
    }
  });

  it('rejects an unrecognized or legacy value', () => {
    expect(isBusinessCategory('groceries')).toBe(false);
    expect(isBusinessCategory('')).toBe(false);
  });
});

describe('normalizeBusinessCategory', () => {
  it('returns a recognized category unchanged', () => {
    expect(normalizeBusinessCategory('food')).toBe('food');
  });

  it('falls back to other for anything unrecognized', () => {
    expect(normalizeBusinessCategory('groceries')).toBe('other');
    expect(normalizeBusinessCategory('')).toBe('other');
  });
});
