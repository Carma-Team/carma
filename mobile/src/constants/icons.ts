import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Central icon registry.
 * Change an icon here — it updates everywhere in the app.
 *
 * Usage:
 *   import { ICONS } from '@/constants/icons';
 *   <Ionicons name={ICONS.home} size={24} color={color} />
 */
export const ICONS = {
  // ─── Navigation tabs ────────────────────────────────────────────────────────
  home:           'home'                      as IoniconName,
  roadmap:        'map'                       as IoniconName,
  marketplace:    'gift'                      as IoniconName,
  leaderboard:    'trophy'                    as IoniconName,
  profile:        'person'                    as IoniconName,

  // ─── Stats ──────────────────────────────────────────────────────────────────
  trips:          'car-sport'                 as IoniconName,
  distance:       'location'                  as IoniconName,
  points:         'star'                      as IoniconName,
  duration:       'time'                      as IoniconName,
  avgScore:       'speedometer'               as IoniconName,
  safeTrips:      'shield-checkmark'          as IoniconName,
  streak:         'flame'                     as IoniconName,

  // ─── Driving events ─────────────────────────────────────────────────────────
  hardBrake:      'alert-circle'              as IoniconName,
  aggressiveAccel:'trending-up'               as IoniconName,
  sharpTurn:      'git-branch'                as IoniconName,
  phoneUsage:     'phone-portrait'            as IoniconName,

  // ─── Actions ────────────────────────────────────────────────────────────────
  startTrip:      'play-circle'               as IoniconName,
  endTrip:        'stop-circle'               as IoniconName,
  settings:       'settings'                  as IoniconName,
  bluetooth:      'bluetooth'                 as IoniconName,
  back:           'arrow-back'                as IoniconName,
  locked:         'lock-closed'               as IoniconName,
  edit:           'create-outline'            as IoniconName,
  trash:          'trash-outline'             as IoniconName,
  logout:         'log-out-outline'           as IoniconName,
  globe:          'globe-outline'             as IoniconName,
  active:         'checkmark-circle'          as IoniconName,
  inactive:       'close-circle'              as IoniconName,
  car:            'car-sport'                 as IoniconName,
  flash:          'flash'                     as IoniconName,
  // Distinct from the GPS arrow the current-location control uses — the two sat side
  // by side on the trip map and read as the same button (CAR-241).
  openInMaps:     'map-outline'               as IoniconName,

  // ─── Profile section tabs ───────────────────────────────────────────────────
  achievements:   'trophy'                    as IoniconName,
  chart:          'bar-chart'                 as IoniconName,
  notifications:  'notifications'             as IoniconName,
  friendRequests: 'people'                    as IoniconName,

  // ─── Empty states ────────────────────────────────────────────────────────────
  noTrips:        'map'                       as IoniconName,
  noRewards:      'gift'                      as IoniconName,
  noNotifs:       'notifications'             as IoniconName,
  noLocation:     'location'                  as IoniconName,
  // Week-over-week direction on the dashboard trend card. Chevrons rather than
  // arrows: the arrow glyphs read as navigation everywhere else in this app.
  trendUp:        'chevron-up'                as IoniconName,
  trendDown:      'chevron-down'              as IoniconName,
  trendFlat:      'remove'                    as IoniconName,
  // Trip waiting to reach the server — not an error, so no warning triangle.
  notSent:        'cloud-offline'             as IoniconName,
} as const;

/** Returns the outline variant of an icon name (for inactive/unfocused state). */
export function outlineIcon(name: IoniconName): IoniconName {
  return `${name}-outline` as IoniconName;
}

/**
 * Presentation for each level, keyed by level number.
 *
 * `GET /api/levels` also sends a `color` and an `icon` per level, and this map
 * deliberately overrides both: how a level looks is a client concern, the same way
 * CATEGORY_CONFIG below owns the look of a server-sent reward category. The server
 * stays the source of truth for the ladder itself — thresholds, multipliers, which
 * level a driver is on.
 *
 * Consequence worth knowing: changing a colour in `server/app/services/levels.py`
 * will NOT change anything in the app. Change it here.
 */
export const LEVEL_THEME: Record<number, { color: string; icon: IoniconName }> = {
  // Lime rather than the server's grey — grey read as "locked" next to the lock icon,
  // leaving no way to tell the level you're on from one you haven't reached.
  1:  { color: '#84cc16', icon: 'leaf-outline'             as IoniconName },
  2:  { color: '#22c55e', icon: 'compass-outline'          as IoniconName },
  3:  { color: '#16a34a', icon: 'aperture-outline'         as IoniconName },
  4:  { color: '#0d9488', icon: 'flash-outline'            as IoniconName },
  5:  { color: '#3b82f6', icon: 'shield-checkmark-outline' as IoniconName },
  6:  { color: '#6366f1', icon: 'flame-outline'            as IoniconName },
  7:  { color: '#8b5cf6', icon: 'star-outline'             as IoniconName },
  8:  { color: '#f59e0b', icon: 'diamond-outline'          as IoniconName },
  9:  { color: '#ef4444', icon: 'trophy-outline'           as IoniconName },
  10: { color: '#f97316', icon: 'ribbon-outline'           as IoniconName },
};

/** Falls back to the top level's look — a level number off the ladder still renders. */
export function levelTheme(level: number) {
  return LEVEL_THEME[level] ?? LEVEL_THEME[10];
}

export interface CategoryConfig {
  icon: IoniconName;
  color: string;
  bg: string;
  labelHe: string;
  labelEn: string;
}

// Single source of truth for reward categories — icon, color and label together.
// Was split across this file (icon/color only) and lib/constants.ts (label only,
// with its own 'other'/cube-outline that had already drifted from this file's
// gift-outline fallback below). Merged so a category picker has one place to read.
export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  fuel:          { icon: 'car-outline',        color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', labelHe: 'דלק',          labelEn: 'Fuel' },
  food:          { icon: 'restaurant-outline', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  labelHe: 'אוכל ושתייה',  labelEn: 'Food & Drink' },
  eco:           { icon: 'leaf-outline',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  labelHe: 'תחבורה ירוקה', labelEn: 'Green Transit' },
  entertainment: { icon: 'film-outline',       color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', labelHe: 'בידור',        labelEn: 'Entertainment' },
  shopping:      { icon: 'cart-outline',       color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',  labelHe: 'קניות',        labelEn: 'Shopping' },
  other:         { icon: 'gift-outline',       color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', labelHe: 'אחר',         labelEn: 'Other' },
};

export const DEFAULT_CATEGORY: CategoryConfig = CATEGORY_CONFIG.other;

// Same shape lib/constants.ts's REWARD_CATEGORIES had (key/labelHe/labelEn/icon),
// derived so the two never drift apart again.
export const REWARD_CATEGORIES = Object.entries(CATEGORY_CONFIG).map(([key, c]) => ({
  key, labelHe: c.labelHe, labelEn: c.labelEn, icon: c.icon,
}));
