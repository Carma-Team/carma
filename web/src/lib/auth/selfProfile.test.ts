import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi } from './authApi';
import { attemptRefresh } from './refresh';
import { applySelfNameChange } from './selfProfile';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

// Same convention as `selfMembership.test.ts`: only the network boundary is
// mocked, so this exercises the real session-lineage check in
// `session.ts::applyRefreshSuccess`.
vi.mock('./authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authApi')>();
  return { ...actual, authApi: { ...actual.authApi, refresh: vi.fn() } };
});

const USER: AuthUser = {
  id: 'u-self',
  name: 'Dana Levi',
  email: 'dana@example.com',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
};

describe('applySelfNameChange', () => {
  beforeEach(() => {
    vi.mocked(authApi.refresh).mockReset();
    setSession({ accessToken: 'tok-old', user: USER });
  });

  afterEach(() => {
    setSession(null);
  });

  it('does nothing for a different user id than the one signed in', async () => {
    await applySelfNameChange('someone-else', 'New Name');

    expect(getSession()?.user.name).toBe('Dana Levi');
  });

  it('does nothing when there is no session at all', async () => {
    setSession(null);

    await applySelfNameChange('u-self', 'New Name');

    expect(getSession()).toBeNull();
  });

  it('patches the name synchronously before the server round trip resolves', async () => {
    // Resolved rather than left hanging (unlike a real "still in flight"
    // moment) — `refresh.ts`'s single-flight `inFlight` guard is
    // module-scoped, so an unresolved mock here would wedge every later test
    // in this file onto the same eternally-pending promise (see
    // `router.test.tsx`'s own comment on the same trap).
    let resolveRefresh!: (value: { token: string; user: AuthUser }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const mutation = applySelfNameChange('u-self', 'Dana Cohen');
    expect(getSession()?.user.name).toBe('Dana Cohen');

    resolveRefresh({ token: 'tok-old', user: USER });
    await mutation;
  });

  it('is not overwritten by an older in-flight refresh resolving afterward with the pre-edit name', async () => {
    let resolveOldRefresh!: (value: { token: string; user: AuthUser }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOldRefresh = resolve;
      }),
    );

    const staleRefresh = attemptRefresh();
    const mutation = applySelfNameChange('u-self', 'Dana Cohen');
    expect(getSession()?.user.name).toBe('Dana Cohen');

    resolveOldRefresh({ token: 'tok-rotated', user: USER });
    await Promise.all([staleRefresh, mutation]);

    expect(getSession()?.user.name).toBe('Dana Cohen');
    expect(getSession()?.accessToken).toBe('tok-rotated');
  });
});
