import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessRequestStatusPage } from './BusinessRequestStatusPage';
import { requestStatusCheckOtp, verifyOtp } from '@/lib/auth/otpApi';
import { getJoinRequestStatus } from '@/lib/api/businessRegistration';
import { getSession, setSession } from '@/lib/auth/session';
import type { AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/auth/otpApi', () => ({ requestStatusCheckOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/lib/api/businessRegistration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessRegistration')>();
  return { ...actual, getJoinRequestStatus: vi.fn() };
});

const USER: AuthUser = {
  id: 'u1',
  name: 'Dana Cohen',
  email: null,
  role: 'DRIVER',
  businessId: null,
  businessCategory: null,
  businessName: null,
  businessNameHe: null,
};

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <BusinessRequestStatusPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

async function requestCodeFor(phone: string) {
  fireEvent.change(screen.getByLabelText('טלפון נייד'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: 'שליחת קוד אימות' }));
  await waitFor(() => expect(screen.getByLabelText('קוד אימות')).toBeInTheDocument());
}

describe('BusinessRequestStatusPage', () => {
  beforeEach(() => {
    setSession(null);
    vi.mocked(requestStatusCheckOtp).mockReset();
    vi.mocked(verifyOtp).mockReset();
    vi.mocked(getJoinRequestStatus).mockReset();
  });

  it('never creates an account while checking status — only requests a login OTP', async () => {
    vi.mocked(requestStatusCheckOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });

    renderPage();
    await requestCodeFor('+972501234567');

    expect(requestStatusCheckOtp).toHaveBeenCalledWith('+972501234567');
  });

  it('shows the pending status without implying approval, and never writes the OTP token to the shared session', async () => {
    vi.mocked(requestStatusCheckOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(getJoinRequestStatus).mockResolvedValue({
      outcome: 'ok',
      status: { status: 'pending', createdAt: '2026-08-27T00:00:00Z', reviewerNote: null },
    });

    renderPage();
    await requestCodeFor('+972501234567');
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ובדיקת הסטטוס' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ממתין לבדיקה' })).toBeInTheDocument());
    expect(screen.getByText('הבקשה שלכם עדיין בבדיקה. זה עדיין לא אישור.')).toBeInTheDocument();
    expect(getJoinRequestStatus).toHaveBeenCalledWith('jwt-1');
    expect(getSession()).toBeNull();
  });

  it('tells the applicant plainly when no request exists for the phone', async () => {
    vi.mocked(requestStatusCheckOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(verifyOtp).mockResolvedValue({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    vi.mocked(getJoinRequestStatus).mockResolvedValue({ outcome: 'ok', status: { status: 'none', createdAt: null, reviewerNote: null } });

    renderPage();
    await requestCodeFor('+972501234567');
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ובדיקת הסטטוס' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'לא נמצאה בקשה' })).toBeInTheDocument());
  });

  it('uses its own accurate verify button and loading copy — this page never submits a request', async () => {
    vi.mocked(requestStatusCheckOtp).mockResolvedValue({ outcome: 'ok', expiresInSeconds: 300 });
    vi.mocked(getJoinRequestStatus).mockResolvedValue({ outcome: 'ok', status: { status: 'none', createdAt: null, reviewerNote: null } });

    renderPage();
    await requestCodeFor('+972501234567');

    // Not "Verify and submit request" — that copy belongs to
    // BusinessRegistrationPage, which actually submits something.
    expect(screen.getByRole('button', { name: 'אימות ובדיקת הסטטוס' })).toBeInTheDocument();
    expect(screen.queryByText('אימות ושליחת הבקשה')).not.toBeInTheDocument();

    let resolveVerify!: (result: { outcome: 'ok'; accessToken: string; user: AuthUser }) => void;
    vi.mocked(verifyOtp).mockReturnValue(new Promise((resolve) => (resolveVerify = resolve)));
    fireEvent.change(screen.getByLabelText('קוד אימות'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'אימות ובדיקת הסטטוס' }));

    await waitFor(() => expect(screen.getByText('בודקים את הסטטוס…')).toBeInTheDocument());
    expect(screen.queryByText('שולחים את הבקשה שלכם…')).not.toBeInTheDocument();

    resolveVerify({ outcome: 'ok', accessToken: 'jwt-1', user: USER });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לא נמצאה בקשה' })).toBeInTheDocument());
  });

  it('renders in Hebrew RTL by default', () => {
    renderPage();

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'בדיקת סטטוס הבקשה' })).toBeInTheDocument();
  });
});
