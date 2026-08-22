import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSession, setSession, subscribeSession } from './session';
import type { AuthUser } from './types';

const USER: AuthUser = {
  id: '1',
  name: 'Biz Owner',
  email: 'biz@carma.app',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'FOOD',
};

describe('session store', () => {
  beforeEach(() => {
    setSession(null);
  });

  it('starts with no session', () => {
    expect(getSession()).toBeNull();
  });

  it('reflects the last value set', () => {
    setSession({ accessToken: 'abc', user: USER });
    expect(getSession()).toEqual({ accessToken: 'abc', user: USER });
  });

  it('notifies subscribers on every change, including a clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    setSession({ accessToken: 'abc', user: USER });
    setSession(null);

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('stops notifying once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    unsubscribe();

    setSession({ accessToken: 'abc', user: USER });

    expect(listener).not.toHaveBeenCalled();
  });
});
