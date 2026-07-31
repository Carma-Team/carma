/**
 * @fileoverview Notification screen logic — rendering decisions and screen state
 * @module lib/notifications
 *
 * @description
 * Pure TypeScript, no React and no API calls, per the layer rules in
 * `mobile/STRUCTURE.md`. `NotificationsTab` owns the effects; everything that
 * can be reasoned about — what a row says, what tapping it should do, and what
 * the screen shows after a request fails — lives here so it can be tested
 * without a rendering harness.
 */
import type { Notification, NotificationType } from '@/types';

export type NotificationIcon = 'trophy' | 'trending-down' | 'person-add' | 'person-circle';

/** What tapping a row should do beyond marking it read. */
export type TapAction = 'open-friend-requests' | 'none';

export interface NotificationView {
  text: string;
  icon: NotificationIcon;
}

/** Screen-level banner, shown above whatever rows are already on screen. */
export type NotificationsBanner = 'load-failed' | 'mark-failed' | 'mark-all-failed';

export interface NotificationsState {
  status: 'loading' | 'ready' | 'error';
  items: Notification[];
  banner: NotificationsBanner | null;
}

export const initialState: NotificationsState = { status: 'loading', items: [], banner: null };

type Translate = (key: string) => string;

/**
 * The message and icon for a row, or null for a kind this build does not know.
 *
 * Not a theoretical branch: `type` is a plain varchar server-side so a new kind
 * ships without a migration, and store rollout leaves installed apps weeks behind
 * the server. The union is exhaustive as *declared*, so the compiler cannot help —
 * the value arrives at runtime. Callers drop what they cannot describe.
 *
 * `t` has no interpolation and returns the key itself when missing, so
 * placeholders are substituted here.
 */
export function describeNotification(n: Notification, t: Translate): NotificationView | null {
  switch (n.type) {
    case 'level_up':
      return {
        text: t('notifications.levelUp').replace('{level}', String(n.payload.level)),
        icon: 'trophy',
      };
    case 'level_down':
      // Deliberately names no level, in either direction — see the server constant.
      return { text: t('notifications.levelDown'), icon: 'trending-down' };
    case 'friend_accepted':
      // The other user may have no name set; fall back rather than printing "null".
      return {
        text: n.payload.userName
          ? t('notifications.friendAccepted').replace('{name}', n.payload.userName)
          : t('notifications.friendAcceptedAnon'),
        icon: 'person-add',
      };
    case 'friend_requested':
      return {
        text: n.payload.userName
          ? t('notifications.friendRequested').replace('{name}', n.payload.userName)
          : t('notifications.friendRequestedAnon'),
        icon: 'person-circle',
      };
    default:
      return null;
  }
}

/**
 * Where a tap should go, given who currently has a request pending.
 *
 * Only an outstanding friend request leads anywhere. A request that has since
 * been answered, withdrawn or blocked goes nowhere and says nothing extra —
 * navigating to a tab that no longer lists it would be worse than staying put.
 * The server deletes the row when the request settles, so a stale row only
 * survives between a settle and the next refresh; `pendingRequesterIds` is what
 * closes that window.
 */
export function tapActionFor(n: Notification, pendingRequesterIds: ReadonlySet<string>): TapAction {
  if (n.type !== 'friend_requested') return 'none';
  return pendingRequesterIds.has(n.payload.userId) ? 'open-friend-requests' : 'none';
}

export function hasUnread(items: readonly Notification[]): boolean {
  return items.some(n => n.readAt === null);
}

/** Rows this build can render, in the order the server returned them. */
export function visibleRows(
  items: readonly Notification[],
  t: Translate
): { notification: Notification; view: NotificationView }[] {
  const rows: { notification: Notification; view: NotificationView }[] = [];
  for (const notification of items) {
    const view = describeNotification(notification, t);
    if (view !== null) rows.push({ notification, view });
  }
  return rows;
}

// ─── State transitions ───────────────────────────────────────────────────────

export function loaded(items: Notification[]): NotificationsState {
  return { status: 'ready', items, banner: null };
}

/**
 * A failed fetch. With rows already on screen this is a failed refresh: keep them
 * and explain above them. With nothing on screen it is a failed first load, which
 * must not be shown as "no notifications" — the user would be told something false
 * about their account because the network was down.
 */
export function loadFailed(prev: NotificationsState): NotificationsState {
  return prev.items.length > 0
    ? { ...prev, status: 'ready', banner: 'load-failed' }
    : { status: 'error', items: [], banner: 'load-failed' };
}

/** Marks one row. Leaves the banner alone: a stale-data warning from a failed
 *  refresh is still true after an unrelated tap succeeds, and clearing it here
 *  would quietly drop the only signal that the list is out of date. Only a fresh
 *  load clears it. */
export function markedRead(prev: NotificationsState, id: string, at: string): NotificationsState {
  return {
    ...prev,
    banner: prev.banner === 'mark-failed' ? null : prev.banner,
    items: prev.items.map(n => (n.id === id && n.readAt === null ? { ...n, readAt: at } : n)),
  };
}

/** The server did not confirm, so the row stays unread — never show success early. */
export function markFailed(prev: NotificationsState): NotificationsState {
  return { ...prev, banner: 'mark-failed' };
}

export function markedAllRead(prev: NotificationsState, at: string): NotificationsState {
  return {
    ...prev,
    banner: prev.banner === 'mark-all-failed' || prev.banner === 'mark-failed' ? null : prev.banner,
    items: prev.items.map(n => (n.readAt === null ? { ...n, readAt: at } : n)),
  };
}

/** Nothing moves — the button stays available so the user can try again. */
export function markAllFailed(prev: NotificationsState): NotificationsState {
  return { ...prev, banner: 'mark-all-failed' };
}

/** i18n key for a banner, so the component holds no copy of its own. */
export function bannerKey(banner: NotificationsBanner): string {
  switch (banner) {
    case 'load-failed':
      return 'notifications.loadFailed';
    case 'mark-failed':
      return 'notifications.markFailed';
    case 'mark-all-failed':
      return 'notifications.markAllFailed';
  }
}

/** Exported for tests that need to assert exhaustiveness against the server contract. */
export const KNOWN_TYPES: readonly NotificationType[] = [
  'level_up',
  'level_down',
  'friend_accepted',
  'friend_requested',
];
