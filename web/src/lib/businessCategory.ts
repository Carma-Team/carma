/**
 * @fileoverview The business category taxonomy shared across the app
 * @module lib/businessCategory
 *
 * @description
 * Mirrors `server/app/models/enums.py::BusinessCategory` — there is no list
 * endpoint to fetch these from, so this is hand-enumerated. Neutral on
 * purpose: business registration (CAR-203) and reward management (CAR-202)
 * both assign a category to something, and neither owns the vocabulary more
 * than the other, so this is the one place it is defined.
 */

export type BusinessCategory = 'fuel' | 'food' | 'eco' | 'entertainment' | 'shopping' | 'other';

export const BUSINESS_CATEGORIES: BusinessCategory[] = ['fuel', 'food', 'eco', 'entertainment', 'shopping', 'other'];

export function isBusinessCategory(value: string): value is BusinessCategory {
  return (BUSINESS_CATEGORIES as string[]).includes(value);
}

// The one fallback rule for "this category string isn't one we recognize" —
// a future enum member the client hasn't been updated for, or bad legacy
// data. 'other' rather than crashing or rendering blank. Only for read paths
// (e.g. rendering a badge for data that already exists); a form picking a
// category for something new should mark it required rather than silently
// defaulting through this.
export function normalizeBusinessCategory(value: string): BusinessCategory {
  return isBusinessCategory(value) ? value : 'other';
}
