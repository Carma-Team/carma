/**
 * The notification screen's decisions, tested without a rendering harness.
 *
 * The repo's jest setup is `ts-jest` on `testEnvironment: 'node'` with no
 * `@testing-library/react-native`, so component rendering is not testable here.
 * That is why this logic lives in `src/lib/` rather than inside the component —
 * which is also what the layer rules in `mobile/STRUCTURE.md` require. What
 * remains in `NotificationsTab` is effects and JSX, with no decisions of its own.
 */
import {
  KNOWN_TYPES,
  bannerKey,
  describeNotification,
  hasUnread,
  initialState,
  loadFailed,
  loaded,
  markAllFailed,
  markFailed,
  markedAllRead,
  markedRead,
  tapActionFor,
  visibleRows,
} from '../notifications';
import type { Notification } from '@/types';

/** Echoes the key so a missing translation is visible, mirroring the real `t`. */
const t = (key: string) => key;

const AT = '2026-07-31T10:00:00Z';

function levelUp(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n-up',
    type: 'level_up',
    payload: { level: 4, previousLevel: 3 },
    readAt: null,
    createdAt: AT,
    ...over,
  } as Notification;
}

function levelDown(over: Partial<Notification> = {}): Notification {
  return { id: 'n-down', type: 'level_down', payload: {}, readAt: null, createdAt: AT, ...over } as Notification;
}

function requested(userId: string, over: Partial<Notification> = {}): Notification {
  return {
    id: `n-req-${userId}`,
    type: 'friend_requested',
    payload: { userId, userName: 'Dana' },
    readAt: null,
    createdAt: AT,
    ...over,
  } as Notification;
}

function accepted(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n-acc',
    type: 'friend_accepted',
    payload: { userId: 'u9', userName: 'Yoni' },
    readAt: null,
    createdAt: AT,
    ...over,
  } as Notification;
}

describe('describeNotification', () => {
  it('renders every kind this build declares', () => {
    for (const n of [levelUp(), levelDown(), requested('u1'), accepted()]) {
      expect(describeNotification(n, t)).not.toBeNull();
    }
  });

  it('substitutes the level, since t has no interpolation', () => {
    expect(describeNotification(levelUp(), t)!.text).toBe('notifications.levelUp'.replace('{level}', '4'));
  });

  it('names no level on a demotion', () => {
    const view = describeNotification(levelDown(), t)!;
    expect(view.text).toBe('notifications.levelDown');
    expect(view.text).not.toMatch(/\d/);
  });

  it('falls back to nameless copy rather than printing null', () => {
    const anon = requested('u1', { payload: { userId: 'u1', userName: null } } as Partial<Notification>);
    expect(describeNotification(anon, t)!.text).toBe('notifications.friendRequestedAnon');
  });

  it('returns null for a kind a newer server introduced', () => {
    // Store rollout leaves installed apps behind the server, and `type` is a
    // varchar precisely so new kinds ship without a migration.
    const future = { id: 'x', type: 'streak_broken', payload: {}, readAt: null, createdAt: AT };
    expect(describeNotification(future as unknown as Notification, t)).toBeNull();
  });

  it('covers every declared type — a new kind must not be forgotten here', () => {
    expect(KNOWN_TYPES).toHaveLength(4);
  });
});

describe('visibleRows', () => {
  it('drops undescribable rows and keeps server order', () => {
    const future = { id: 'x', type: 'streak_broken', payload: {}, readAt: null, createdAt: AT };
    const rows = visibleRows([levelUp(), future as unknown as Notification, levelDown()], t);
    expect(rows.map(r => r.notification.id)).toEqual(['n-up', 'n-down']);
  });

  it('is empty when nothing is recognisable, so the caller shows the empty state', () => {
    const future = { id: 'x', type: 'streak_broken', payload: {}, readAt: null, createdAt: AT };
    expect(visibleRows([future as unknown as Notification], t)).toHaveLength(0);
  });
});

describe('tapActionFor', () => {
  it('routes a request that is still pending', () => {
    expect(tapActionFor(requested('u1'), new Set(['u1']))).toBe('open-friend-requests');
  });

  it('goes nowhere once the request has been answered or withdrawn', () => {
    // Navigating to a tab that no longer lists it would be worse than staying put.
    expect(tapActionFor(requested('u1'), new Set())).toBe('none');
  });

  it('never routes the other kinds', () => {
    const anyone = new Set(['u1', 'u9']);
    expect(tapActionFor(accepted(), anyone)).toBe('none');
    expect(tapActionFor(levelUp(), anyone)).toBe('none');
    expect(tapActionFor(levelDown(), anyone)).toBe('none');
  });
});

describe('load', () => {
  it('shows the rows it got', () => {
    const s = loaded([levelUp()]);
    expect(s.status).toBe('ready');
    expect(s.banner).toBeNull();
  });

  it('a failed first load is an error, never an empty list', () => {
    // "No notifications" would tell the user something false about their account
    // when the truth is the server did not answer.
    const s = loadFailed(initialState);
    expect(s.status).toBe('error');
    expect(s.banner).toBe('load-failed');
    expect(s.items).toEqual([]);
  });

  it('a failed refresh keeps what is already on screen', () => {
    const s = loadFailed(loaded([levelUp(), levelDown()]));
    expect(s.status).toBe('ready');
    expect(s.banner).toBe('load-failed');
    expect(s.items).toHaveLength(2);
  });
});

describe('marking one read', () => {
  it('marks only that row', () => {
    const s = markedRead(loaded([levelUp(), levelDown()]), 'n-up', AT);
    expect(s.items.find(n => n.id === 'n-up')!.readAt).toBe(AT);
    expect(s.items.find(n => n.id === 'n-down')!.readAt).toBeNull();
    expect(s.banner).toBeNull();
  });

  it('leaves an already-read row alone', () => {
    const earlier = '2026-07-30T09:00:00Z';
    const s = markedRead(loaded([levelUp({ readAt: earlier })]), 'n-up', AT);
    expect(s.items[0].readAt).toBe(earlier);
  });

  it('a failure leaves the row unread — no optimistic success', () => {
    const s = markFailed(loaded([levelUp()]));
    expect(s.items[0].readAt).toBeNull();
    expect(s.banner).toBe('mark-failed');
  });

  it('keeps a stale-data warning up: the list is still stale after an unrelated tap', () => {
    const staleRefresh = loadFailed(loaded([levelUp(), levelDown()]));
    expect(staleRefresh.banner).toBe('load-failed');

    const s = markedRead(staleRefresh, 'n-up', AT);
    expect(s.banner).toBe('load-failed');
    expect(s.items.find(n => n.id === 'n-up')!.readAt).toBe(AT);
  });

  it('clears its own failure banner once a retry succeeds', () => {
    const s = markedRead(markFailed(loaded([levelUp()])), 'n-up', AT);
    expect(s.banner).toBeNull();
  });
});

describe('marking all read', () => {
  it('clears every unread row and hides the button', () => {
    const s = markedAllRead(loaded([levelUp(), levelDown()]), AT);
    expect(s.items.every(n => n.readAt === AT)).toBe(true);
    expect(hasUnread(s.items)).toBe(false);
  });

  it('a failure moves nothing, so the button stays available', () => {
    const before = loaded([levelUp(), levelDown()]);
    const s = markAllFailed(before);
    expect(s.items).toEqual(before.items);
    expect(hasUnread(s.items)).toBe(true);
    expect(s.banner).toBe('mark-all-failed');
  });

  it('also keeps a stale-data warning up', () => {
    const s = markedAllRead(loadFailed(loaded([levelUp()])), AT);
    expect(s.banner).toBe('load-failed');
    expect(hasUnread(s.items)).toBe(false);
  });
});

describe('bannerKey', () => {
  it('maps each banner to its own copy', () => {
    const keys = (['load-failed', 'mark-failed', 'mark-all-failed'] as const).map(bannerKey);
    expect(new Set(keys).size).toBe(3);
  });
});
