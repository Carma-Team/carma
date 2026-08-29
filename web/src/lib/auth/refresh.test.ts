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
});
