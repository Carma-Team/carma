import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attemptRefresh } from './refresh';
import { authApi, AuthApiError } from './authApi';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

vi.mock('./authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authApi')>();
  return { ...actual, authApi: { refresh: vi.fn() } };
});

const USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: null,
  businessCategory: null,
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

describe('attemptRefresh', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(authApi.refresh).mockReset();
  });

  it('stores the new session and returns "ok" on success', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });

    expect(await attemptRefresh()).toBe('ok');
    expect(getSession()).toEqual({ accessToken: 'tok-1', user: USER });
  });

  // ─── the four categories the server/client can actually produce ──────────

  it('a genuine 401 rejection clears the session and returns "rejected"', async () => {
    setSession({ accessToken: 'stale', user: USER });
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    expect(await attemptRefresh()).toBe('rejected');
    expect(getSession()).toBeNull();
  });

  it('a network failure leaves an existing session untouched and returns "transient"', async () => {
    const live = { accessToken: 'still-good', user: USER };
    setSession(live);
    // What a real network drop looks like at the fetch layer — not an
    // AuthApiError at all, since the request never got a response to build
    // one from.
    vi.mocked(authApi.refresh).mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await attemptRefresh()).toBe('transient');
    expect(getSession()).toEqual(live);
  });

  it('a 429 leaves an existing session untouched and returns "transient"', async () => {
    const live = { accessToken: 'still-good', user: USER };
    setSession(live);
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(429, 'Too many attempts. Try again shortly.'));

    expect(await attemptRefresh()).toBe('transient');
    expect(getSession()).toEqual(live);
  });

  it('a 5xx leaves an existing session untouched and returns "transient"', async () => {
    const live = { accessToken: 'still-good', user: USER };
    setSession(live);
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(500, 'Internal server error'));

    expect(await attemptRefresh()).toBe('transient');
    expect(getSession()).toEqual(live);
  });

  it('a transient failure with no prior session leaves it null, not cleared-as-if-it-were-something', async () => {
    // Same "leave it alone" behaviour, from the bootstrap angle: there was
    // never a session to protect, and this must not manufacture one either.
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(503, 'Service unavailable'));

    expect(await attemptRefresh()).toBe('transient');
    expect(getSession()).toBeNull();
  });

  it('a timeout (authApi\'s own AuthApiError(0, …)) is transient, not a rejection', async () => {
    // What `authApi.ts`'s AbortController produces — status 0, never a real
    // HTTP response. Must not be mistaken for the server's 401.
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(0, 'Request timed out'));

    expect(await attemptRefresh()).toBe('transient');
  });

  // ─── single-flight ─────────────────────────────────────────────────────

  it('shares one in-flight call across concurrent callers instead of racing the cookie rotation', async () => {
    let resolveRefresh!: (value: { token: string; user: AuthUser }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const first = attemptRefresh();
    const second = attemptRefresh();
    resolveRefresh({ token: 'tok-2', user: USER });

    expect(await first).toBe('ok');
    expect(await second).toBe('ok');
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it('a transient failure clears the in-flight lock, so the next call tries again rather than staying stuck', async () => {
    vi.mocked(authApi.refresh).mockRejectedValueOnce(new AuthApiError(0, 'Request timed out'));
    vi.mocked(authApi.refresh).mockResolvedValueOnce({ token: 'tok-3', user: USER });

    expect(await attemptRefresh()).toBe('transient');
    expect(await attemptRefresh()).toBe('ok');
    expect(authApi.refresh).toHaveBeenCalledTimes(2);
  });

  // ─── session lineage ───────────────────────────────────────────────────
  // CAR-117 final review: a stale response must be judged against the exact
  // session it was requested for (`session.ts`'s `captureLineage`/
  // `isStillTheSameSession`) — not just "did anything change" (the
  // generation counter alone), and not "does a session merely exist".

  it('a logout while a refresh is in flight is not undone by a stale "ok" response resolving afterward', async () => {
    let resolveOld!: (value: { token: string; user: AuthUser }) => void;
    setSession({ accessToken: 'old-tok', user: USER });
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );

    const stale = attemptRefresh();
    setSession(null); // logout

    resolveOld({ token: 'old-tok-rotated', user: USER });
    expect(await stale).toBe('ok');
    expect(getSession()).toBeNull();
  });

  it('a logout while a refresh is in flight is not undone by a stale "rejected" response resolving afterward', async () => {
    let rejectOld!: (err: unknown) => void;
    setSession({ accessToken: 'old-tok', user: USER });
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );

    const stale = attemptRefresh();
    setSession(null); // already logged out — the 401 below tells us nothing new

    rejectOld(new AuthApiError(401, 'Session expired'));
    expect(await stale).toBe('rejected');
    expect(getSession()).toBeNull();
  });

  it('a different user logging in while an older refresh is in flight is not overwritten, and no token is mixed across users', async () => {
    let resolveOld!: (value: { token: string; user: AuthUser }) => void;
    const userB: AuthUser = { ...USER, id: '2', name: 'User B' };
    setSession({ accessToken: 'A-old-tok', user: USER });
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );

    const stale = attemptRefresh(); // in flight for user 1 ("USER")
    setSession(null);
    setSession({ accessToken: 'B-fresh-tok', user: userB }); // a different user signs in

    resolveOld({ token: 'A-rotated-tok', user: USER }); // the stale call's own response, still user 1
    await stale;

    expect(getSession()).toEqual({ accessToken: 'B-fresh-tok', user: userB });
  });

  it('logging out and back in as the same user with a new token while an older refresh is in flight discards the stale response entirely', async () => {
    let resolveOld!: (value: { token: string; user: AuthUser }) => void;
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );

    const stale = attemptRefresh(); // in flight while the session still holds 'tok-1'
    setSession(null);
    setSession({ accessToken: 'tok-2', user: USER }); // same user, but a genuinely new session/token

    resolveOld({ token: 'tok-1-rotated', user: USER }); // rotated from the now-superseded 'tok-1'
    await stale;

    // A same user ID alone is not enough lineage to adopt this token — it
    // was rotated from a cookie the current session never presented.
    expect(getSession()).toEqual({ accessToken: 'tok-2', user: USER });
  });

  it('a same-session refresh started before a self-membership patch still adopts its rotated token once the patch has landed', async () => {
    let resolveOld!: (value: { token: string; user: AuthUser }) => void;
    setSession({ accessToken: 'tok-1', user: USER });
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );

    const stale = attemptRefresh();
    // Same session, same token — only the user's own profile fields change,
    // exactly what `selfMembership.ts`'s synchronous patch does.
    const patched = { ...getSession()!, user: { ...USER, businessMembershipRole: 'MANAGER' as const } };
    setSession(patched);

    resolveOld({ token: 'tok-1-rotated', user: USER });
    await stale;

    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');
    expect(getSession()?.accessToken).toBe('tok-1-rotated');
  });
});
