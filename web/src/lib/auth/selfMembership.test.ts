import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi } from './authApi';
import { attemptRefresh } from './refresh';
import { applySelfMembershipChange } from './selfMembership';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

// The real `refresh.ts` and `session.ts` — the whole point of these tests is
// proving the actual session-lineage check in `session.ts::applyRefreshSuccess`
// (exercised through `refresh.ts::attemptRefresh`), not a mock's behavior.
// Only the network boundary, `authApi.refresh`, is mocked.
vi.mock('./authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authApi')>();
  return { ...actual, authApi: { ...actual.authApi, refresh: vi.fn() } };
});

const OWNER_USER: AuthUser = {
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

// CAR-117 final review finding: `attemptRefresh()`'s single in-flight promise
// is shared by every caller app-wide. If some other part of the app already
// started a refresh before a self-demotion/self-revocation, `reconcileSelf`'s
// own `attemptRefresh()` call inside `applySelfMembershipChange` gets that
// *same* promise back — and when it resolves, it carries the profile the
// server computed before the mutation happened. These tests reproduce that
// exact interleaving against the real refresh/session modules.
describe('applySelfMembershipChange vs. an already-in-flight refresh', () => {
  beforeEach(() => {
    vi.mocked(authApi.refresh).mockReset();
    setSession({ accessToken: 'tok-old', user: OWNER_USER });
  });

  afterEach(() => {
    setSession(null);
  });

  it('a self-demotion is not overwritten by an older in-flight refresh resolving afterward with the pre-mutation OWNER profile', async () => {
    let resolveOldRefresh!: (value: { token: string; user: AuthUser }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOldRefresh = resolve;
      }),
    );

    // Represents a refresh already in flight elsewhere in the app, started
    // before the mutation below.
    const staleRefresh = attemptRefresh();

    // `applySelfMembershipChange` patches the session synchronously before
    // its own `await attemptRefresh()` — that await resolves the *same*
    // in-flight promise as `staleRefresh` above, since one is already
    // pending.
    const mutation = applySelfMembershipChange('u-self', 'MANAGER');
    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');

    // The older refresh finally lands, with the profile the server computed
    // before the demotion.
    resolveOldRefresh({ token: 'tok-rotated', user: OWNER_USER });
    await Promise.all([staleRefresh, mutation]);

    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');
    // A freshly rotated token is still adopted — it may be the only valid one left.
    expect(getSession()?.accessToken).toBe('tok-rotated');
  });

  it('a self-revocation clears the business context and is not restored by an older in-flight refresh resolving afterward', async () => {
    let resolveOldRefresh!: (value: { token: string; user: AuthUser }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveOldRefresh = resolve;
      }),
    );

    const staleRefresh = attemptRefresh();

    const mutation = applySelfMembershipChange('u-self', null);
    expect(getSession()?.user.businessMembershipRole).toBeNull();
    expect(getSession()?.user.businessId).toBeNull();
    expect(getSession()?.user.businessName).toBeNull();

    resolveOldRefresh({ token: 'tok-rotated', user: OWNER_USER });
    await Promise.all([staleRefresh, mutation]);

    expect(getSession()?.user.businessMembershipRole).toBeNull();
    expect(getSession()?.user.businessId).toBeNull();
    expect(getSession()?.accessToken).toBe('tok-rotated');
  });

  it('a stale rejected refresh does not clear the session after a self-membership update has landed', async () => {
    let rejectOld!: (err: unknown) => void;
    const { AuthApiError } = await import('./authApi');
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );

    const staleRefresh = attemptRefresh();

    const mutation = applySelfMembershipChange('u-self', 'MANAGER');
    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');

    // The stale call's own 401 — computed against the cookie that was live
    // before the demotion, not against anything the demotion itself did.
    rejectOld(new AuthApiError(401, 'Session expired'));
    await Promise.all([staleRefresh, mutation]);

    expect(getSession()).not.toBeNull();
    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');
  });

  it('a genuinely new refresh (none already in flight) still applies normally', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-fresh', user: { ...OWNER_USER, businessMembershipRole: 'MANAGER' } });

    const outcome = await attemptRefresh();

    expect(outcome).toBe('ok');
    expect(getSession()?.accessToken).toBe('tok-fresh');
    expect(getSession()?.user.businessMembershipRole).toBe('MANAGER');
  });
});
