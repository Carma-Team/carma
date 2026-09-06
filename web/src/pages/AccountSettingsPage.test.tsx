import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AccountSettingsPage } from './AccountSettingsPage';
import { updateName } from '@/lib/api/profile';
import { applySelfNameChange } from '@/lib/auth/selfProfile';
import { useAuth } from '@/hooks/useAuth';
import type { AuthContextValue, AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/api/profile', () => ({ updateName: vi.fn() }));
vi.mock('@/lib/auth/selfProfile', () => ({ applySelfNameChange: vi.fn() }));
vi.mock('@/hooks/useAuth');

const OWNER: AuthUser = {
  id: '1',
  name: 'Dana Levi',
  email: 'dana@aroma-israel.co.il',
  phone: '+972501234567',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
};

function renderPage() {
  return render(
    <LanguageProvider>
      <AccountSettingsPage />
    </LanguageProvider>,
  );
}

function asAuth(user: AuthUser, logout = vi.fn()): AuthContextValue {
  return {
    status: 'authenticated',
    user,
    login: vi.fn(),
    loginWithOtp: vi.fn(),
    register: vi.fn(),
    logout,
    retry: vi.fn(),
  };
}

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as () => void;
    vi.mocked(useAuth).mockReturnValue(asAuth(OWNER));
    vi.mocked(updateName).mockReset();
    vi.mocked(applySelfNameChange).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the signed-in user identity, role and read-only email/phone', () => {
    renderPage();

    expect(screen.getByText('Dana Levi')).toBeInTheDocument();
    expect(screen.getByText('בעל העסק')).toBeInTheDocument();
    expect(screen.getByText('dana@aroma-israel.co.il')).toBeInTheDocument();
    expect(screen.getByText('+972501234567')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('dana@aroma-israel.co.il')).not.toBeInTheDocument();
  });

  it('shows the save bar only once the name is edited, and saves successfully', async () => {
    renderPage();
    expect(screen.queryByText('יש שינויים שלא נשמרו')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Dana Levi'), { target: { value: 'Dana Cohen' } });
    expect(screen.getByText('יש שינויים שלא נשמרו')).toBeInTheDocument();

    vi.mocked(updateName).mockResolvedValue({ outcome: 'ok', name: 'Dana Cohen' });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(screen.getByText('השינויים נשמרו בהצלחה')).toBeInTheDocument());
    expect(updateName).toHaveBeenCalledWith('Dana Cohen');
    expect(applySelfNameChange).toHaveBeenCalledWith('1', 'Dana Cohen');
  });

  it('rejects a blank name without calling the API', () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue('Dana Levi'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    expect(screen.getByText('יש להזין שם.')).toBeInTheDocument();
    expect(updateName).not.toHaveBeenCalled();
  });

  it('keeps the unsaved edit visible and offers a retry when the save fails', async () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue('Dana Levi'), { target: { value: 'Dana Cohen' } });
    vi.mocked(updateName).mockResolvedValue({ outcome: 'network_error' });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Dana Cohen')).toBeInTheDocument();
  });

  it('discards the edit and hides the save bar on cancel', () => {
    renderPage();

    fireEvent.change(screen.getByDisplayValue('Dana Levi'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול השינויים' }));

    expect(screen.getByDisplayValue('Dana Levi')).toBeInTheDocument();
    expect(screen.queryByText('יש שינויים שלא נשמרו')).not.toBeInTheDocument();
  });

  it('opens a coming-soon dialog for password change rather than a real form', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'בקרוב' }));

    expect(screen.getByText('שינוי סיסמה — בקרוב')).toBeInTheDocument();
  });

  it('signs out immediately when there is nothing unsaved', () => {
    const logout = vi.fn();
    vi.mocked(useAuth).mockReturnValue(asAuth(OWNER, logout));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    expect(logout).toHaveBeenCalledOnce();
  });

  it('confirms before signing out over an unsaved name edit', () => {
    const logout = vi.fn();
    vi.mocked(useAuth).mockReturnValue(asAuth(OWNER, logout));
    renderPage();

    fireEvent.change(screen.getByDisplayValue('Dana Levi'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'התנתקות' }));

    expect(screen.getByText('לצאת בלי לשמור?')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'להתנתק בלי לשמור' }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
