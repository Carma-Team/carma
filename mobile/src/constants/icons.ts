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

  // ─── Driving events ─────────────────────────────────────────────────────────
  hardBrake:      'alert-circle'              as IoniconName,
  aggressiveAccel:'trending-up'               as IoniconName,
  sharpTurn:      'git-branch'                as IoniconName,
  swerve:         'swap-horizontal'           as IoniconName,
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
  openInMaps:     'navigate-outline'          as IoniconName,

  // ─── Profile section tabs ───────────────────────────────────────────────────
  achievements:   'trophy'                    as IoniconName,
  chart:          'bar-chart'                 as IoniconName,
  notifications:  'notifications'             as IoniconName,

  // ─── Empty states ────────────────────────────────────────────────────────────
  noTrips:        'map'                       as IoniconName,
  noRewards:      'gift'                      as IoniconName,
  noNotifs:       'notifications'             as IoniconName,
  noLocation:     'location'                  as IoniconName,
} as const;

/** Returns the outline variant of an icon name (for inactive/unfocused state). */
export function outlineIcon(name: IoniconName): IoniconName {
  return `${name}-outline` as IoniconName;
}

export interface CategoryConfig {
  icon: IoniconName;
  color: string;
  bg: string;
}

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  fuel:          { icon: 'car-outline',        color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  food:          { icon: 'restaurant-outline', color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  eco:           { icon: 'leaf-outline',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  entertainment: { icon: 'film-outline',       color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)'  },
  shopping:      { icon: 'cart-outline',       color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'   },
};

export const DEFAULT_CATEGORY: CategoryConfig = {
  icon: 'gift-outline', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)',
};
