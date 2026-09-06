import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessProfilePage } from './BusinessProfilePage';
import { getBusinessProfile, updateBusinessProfile } from '@/lib/api/businessProfile';
import type { BusinessProfile } from '@/lib/api/businessProfile';
import { useAuth } from '@/hooks/useAuth';
import type { AuthContextValue, AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/api/businessProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessProfile')>();
  return { ...actual, getBusinessProfile: vi.fn(), updateBusinessProfile: vi.fn() };
});
vi.mock('@/hooks/useAuth');

const OWNER: AuthUser = {
  id: '1',
  name: 'Dana Levi',
  email: 'dana@aroma-israel.co.il',
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: 'Aroma Israel',
  businessNameHe: null,
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
};

const CASHIER: AuthUser = { ...OWNER, businessMembershipRole: 'CASHIER' };

function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 'b1',
    name: 'Aroma Israel',
    nameHe: null,
    category: 'food',
    address: 'Dizengoff 210, Tel Aviv',
    registrationNumber: '514032897',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <BusinessProfilePage />
    </LanguageProvider>,
  );
}

function asAuth(user: AuthUser): AuthContextValue {
  return {
    status: 'authenticated',
    user,
    login: vi.fn(),
    loginWithOtp: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  };
}

describe('BusinessProfilePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as () => void;
    vi.mocked(useAuth).mockReturnValue(asAuth(OWNER));
    vi.mocked(getBusinessProfile).mockReset();
    vi.mocked(updateBusinessProfile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state while the profile is in flight', () => {
    vi.mocked(getBusinessProfile).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a recoverable error state with retry when the load fails', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'network_error' });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));

    await waitFor(() => expect(getBusinessProfile).toHaveBeenCalledTimes(2));
  });

  it('renders a forbidden state rather than crashing on a 403', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'forbidden' });
    renderPage();

    await waitFor(() => expect(screen.getByText('הגישה מוגבלת')).toBeInTheDocument());
  });

  it('never renders the registration number as an editable field, even for an OWNER', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();

    await waitFor(() => expect(screen.getByText('514032897')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('514032897')).not.toBeInTheDocument();
  });

  it('shows the save bar only once a field is edited, and saves successfully', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    expect(screen.queryByText('יש שינויים שלא נשמרו')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Aroma Israel'), { target: { value: 'Aroma Israel Ltd' } });
    expect(screen.getByText('יש שינויים שלא נשמרו')).toBeInTheDocument();

    vi.mocked(updateBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile({ name: 'Aroma Israel Ltd' }) });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(screen.getByText('השינויים נשמרו בהצלחה')).toBeInTheDocument());
    expect(updateBusinessProfile).toHaveBeenCalledWith({
      name: 'Aroma Israel Ltd',
      nameHe: null,
      category: 'food',
      address: 'Dizengoff 210, Tel Aviv',
    });
  });

  it('keeps the unsaved edit visible and offers a retry when the save fails', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Aroma Israel'), { target: { value: 'Aroma Israel Ltd' } });
    vi.mocked(updateBusinessProfile).mockResolvedValue({ outcome: 'network_error' });
    fireEvent.click(screen.getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Aroma Israel Ltd')).toBeInTheDocument();
  });

  it('discards the edit and hides the save bar on cancel', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Aroma Israel'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'ביטול השינויים' }));

    expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument();
    expect(screen.queryByText('יש שינויים שלא נשמרו')).not.toBeInTheDocument();
  });

  it('confirms before discarding an unsaved edit when switching to the branches tab', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('Aroma Israel'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('tab', { name: /סניפים/ }));

    expect(document.querySelector('dialog')).toHaveAttribute('open');
    expect(screen.getByText('לצאת בלי לשמור?')).toBeInTheDocument();
    // Still on the details tab — the switch has not happened yet.
    expect(screen.getByDisplayValue('Something else')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'לצאת בלי לשמור' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: /סניפים/ })).toHaveAttribute('aria-selected', 'true'));
  });

  it('switches tabs immediately when there is nothing unsaved', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /סניפים/ }));

    // Dialog (native <dialog>) always renders its children in the DOM — only
    // the `open` attribute (toggled by the mocked showModal/close above)
    // says whether it's actually showing, so that's what a "no dialog"
    // assertion has to check, not text presence.
    expect(document.querySelector('dialog')).not.toHaveAttribute('open');
    expect(screen.getByRole('tab', { name: /סניפים/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the single real branch from the business address, with adding another disabled', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Aroma Israel')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /סניפים/ }));

    expect(screen.getByText('Dizengoff 210, Tel Aviv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת סניף' })).toBeDisabled();
  });

  it('shows a CASHIER a read-only view with no editable fields or save bar', async () => {
    vi.mocked(useAuth).mockReturnValue(asAuth(CASHIER));
    vi.mocked(getBusinessProfile).mockResolvedValue({ outcome: 'ok', profile: profile() });
    renderPage();

    await waitFor(() => expect(screen.getByText('Aroma Israel')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Aroma Israel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שמירת שינויים' })).not.toBeInTheDocument();
  });
});
