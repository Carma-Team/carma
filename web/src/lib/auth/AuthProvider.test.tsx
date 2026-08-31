import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useContext } from 'react';
import { AuthProvider } from './AuthProvider';
import { AuthContext } from './context';
import { authApi, AuthApiError } from './authApi';
import { getSession, setSession } from './session';
import type { AuthUser } from './types';

vi.mock('./authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authApi')>();
  return { ...actual, authApi: { refresh: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() } };
});

const USER: AuthUser = {
  id: '1',
  name: 'Biz Owner',
  email: 'biz@carma.app',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'FOOD',
  businessName: 'Aroma',
  businessNameHe: null,
  businessMembershipRole: null,
  businessMembershipAmbiguous: false,
};

function Probe() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('no context');
  return (
    <div>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="user">{ctx.user?.email ?? 'none'}</div>
      {/* SignInPage is the real consumer and already awaits + catches a
          rejected login() (see its handleSubmit) — swallowed here too so a
          future test with a rejecting `authApi.login` surfaces as this
          component's own state rather than an unhandled rejection. */}
      <button onClick={() => ctx.login('biz@carma.app', 'CorrectHorse1').catch(() => {})}>login</button>
      {/* Same swallow-and-surface-as-state convention as login above —
          CreateAccountPage is the real consumer and already awaits + catches
          a rejected register() in its own handleSubmit. */}
      <button onClick={() => ctx.register('New Recipient', 'new@carma.app', 'CorrectHorse1').catch(() => {})}>
        register
      </button>
      <button onClick={() => ctx.logout()}>logout</button>
      <button onClick={() => ctx.retry()}>retry</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(authApi.refresh).mockReset();
    vi.mocked(authApi.login).mockReset();
    vi.mocked(authApi.register).mockReset();
    vi.mocked(authApi.logout).mockReset();
  });

  it('starts loading, then settles unauthenticated when the server genuinely has no session to restore', async () => {
    // A fresh visitor with no cookie gets a real 401 from the server (see
    // `services/auth.py::refresh_session` — "no cookie" is REFRESH_REJECTED,
    // not a network condition), so this is what "rejected" looks like here.
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));

    renderProvider();

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('settles into "error", not "unauthenticated", when bootstrap fails transiently', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(503, 'Service unavailable'));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    // Critically not the same outcome a genuine rejection produces — a
    // transient failure must never present as "you are signed out".
    expect(screen.getByTestId('status')).not.toHaveTextContent('unauthenticated');
  });

  it('retry() re-runs the bootstrap check and can recover into authenticated', async () => {
    vi.mocked(authApi.refresh)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ token: 'tok-recovered', user: USER });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));

    fireEvent.click(screen.getByText('retry'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(authApi.refresh).toHaveBeenCalledTimes(2);
  });

  it('retry() can also land on unauthenticated, if the session turns out to genuinely be gone', async () => {
    vi.mocked(authApi.refresh)
      .mockRejectedValueOnce(new AuthApiError(500, 'Internal server error'))
      .mockRejectedValueOnce(new AuthApiError(401, 'Session expired — sign in again'));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));

    fireEvent.click(screen.getByText('retry'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('restores the session on mount when the refresh cookie is still good — reload survival', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('biz@carma.app');
  });

  it('login moves status to authenticated using the token login itself returned', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again')); // the bootstrap-on-mount call
    // Already short-lived — `X-Requested-With` (sent on every `authApi` call,
    // login included) is what tells `/api/auth/login` this is the web app;
    // see `services/auth.py::login_with_password`. No follow-up refresh
    // needed just to downgrade the token, so `authApi.refresh` is never
    // called again after the bootstrap attempt above.
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-web-short-lived', user: USER });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(authApi.login).toHaveBeenCalledWith('biz@carma.app', 'CorrectHorse1');
    expect(authApi.refresh).toHaveBeenCalledTimes(1); // just the bootstrap attempt, nothing after login
    expect(getSession()?.accessToken).toBe('tok-web-short-lived');
  });

  // CAR-118: a recipient with no CARMA account yet registers mid-invitation-
  // acceptance. `register()` must establish the same kind of session `login`
  // does — proven here through the real provider and the real session store,
  // not through a page that only asserts a mocked `register` was called.
  it('register moves status to authenticated using the token register itself returned', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again')); // the bootstrap-on-mount call
    vi.mocked(authApi.register).mockResolvedValue({ token: 'tok-web-short-lived', user: USER });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    fireEvent.click(screen.getByText('register'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(authApi.register).toHaveBeenCalledWith('New Recipient', 'new@carma.app', 'CorrectHorse1');
    expect(authApi.refresh).toHaveBeenCalledTimes(1); // just the bootstrap attempt, nothing after register
    expect(getSession()?.accessToken).toBe('tok-web-short-lived');
    expect(getSession()?.user.email).toBe('biz@carma.app');
    expect(screen.getByTestId('user')).toHaveTextContent('biz@carma.app');
  });

  it('a rejected registration leaves the session unauthenticated rather than half-set', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));
    vi.mocked(authApi.register).mockRejectedValue(new AuthApiError(409, 'Email already registered'));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    fireEvent.click(screen.getByText('register'));

    // The rejection is caught by the Probe (same convention as login above),
    // so the assertion is on what `register()` left behind in the store —
    // nothing — not on an unhandled rejection.
    await waitFor(() => expect(authApi.register).toHaveBeenCalledOnce());
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(getSession()).toBeNull();
  });

  it('registering does not change how login itself behaves', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new AuthApiError(401, 'Session expired — sign in again'));
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-from-login', user: USER });

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    fireEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(authApi.register).not.toHaveBeenCalled();
    expect(getSession()?.accessToken).toBe('tok-from-login');
  });

  it('logout ends the session even if the server call fails', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ token: 'tok-1', user: USER });
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network down'));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    fireEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });
});
