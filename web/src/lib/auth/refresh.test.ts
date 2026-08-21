import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attemptRefresh } from './refresh';
import { authApi } from './authApi';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

vi.mock('./authApi', () => ({ authApi: { refresh: vi.fn() } }));

const USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: null,
  businessCategory: null,
};

describe('attemptRefresh', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(authApi.refresh).mockReset();
  });

  it('stores the new session and returns true on success', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });

    expect(await attemptRefresh()).toBe(true);
    expect(getSession()).toEqual({ accessToken: 'tok-1', user: USER });
  });

  it('clears the session and returns false when the cookie cannot be refreshed', async () => {
    setSession({ accessToken: 'stale', user: USER });
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('expired'));

    expect(await attemptRefresh()).toBe(false);
    expect(getSession()).toBeNull();
  });

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

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });
});
