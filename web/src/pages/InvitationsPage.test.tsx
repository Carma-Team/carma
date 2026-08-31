import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { InvitationsPage } from './InvitationsPage';
import { createInvitation, listInvitations, revokeInvitation } from '@/lib/api/businessInvitations';
import type { CreatedInvitation, PendingInvitation } from '@/lib/api/businessInvitations';

vi.mock('@/lib/api/businessInvitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessInvitations')>();
  return { ...actual, createInvitation: vi.fn(), listInvitations: vi.fn(), revokeInvitation: vi.fn() };
});

const PENDING_MANAGER: PendingInvitation = {
  id: 'inv-1',
  role: 'manager',
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-04T00:00:00Z',
};

const CREATED: CreatedInvitation = {
  id: 'inv-2',
  role: 'cashier',
  token: 'TXQ947ZKPS',
  url: 'https://business.carma.app/business-invite#TXQ947ZKPS',
  expiresAt: '2026-09-02T00:00:00Z',
};

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <InvitationsPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('InvitationsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as (returnValue?: string) => void;
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.mocked(createInvitation).mockReset();
    vi.mocked(listInvitations).mockReset();
    vi.mocked(revokeInvitation).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists pending invitations with role and expiry from the API', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [PENDING_MANAGER] });

    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).getByText('מנהל')).toBeInTheDocument();
    expect(listInvitations).toHaveBeenCalledOnce();
  });

  it('shows the forbidden state when the server refuses the list', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'forbidden' });

    renderPage();

    await waitFor(() => expect(screen.getByText('רק בעל העסק יכול ליצור הזמנות למימוש הטבות.')).toBeInTheDocument());
  });

  it('shows an empty state when there are no pending invitations', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });

    renderPage();

    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());
  });

  it('creates an invitation for the selected role and shows the link and code with the 72h/one-time notice', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('רמת גישה'), { target: { value: 'cashier' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));

    await waitFor(() => expect(createInvitation).toHaveBeenCalledExactlyOnceWith('cashier'));
    expect(screen.getByText('בתוקף ל-72 שעות, וניתנת לשימוש חד-פעמי בלבד.')).toBeInTheDocument();
    expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument();
    expect(screen.getByDisplayValue(CREATED.token)).toBeInTheDocument();
  });

  it('copies the link and the code to the clipboard, showing transient confirmation', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    await waitFor(() => expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הקישור' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CREATED.url));
    await waitFor(() => expect(screen.getAllByText('הועתק').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הקוד' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CREATED.token));
  });

  it('does not send a second create request while one is already in flight', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    let resolveCreate: (value: Awaited<ReturnType<typeof createInvitation>>) => void = () => {};
    vi.mocked(createInvitation).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());

    const createButton = screen.getByRole('button', { name: 'יצירת הזמנה' });
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    resolveCreate({ outcome: 'ok', invitation: CREATED });
    await waitFor(() => expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument());
    expect(createInvitation).toHaveBeenCalledOnce();
  });

  it('revokes an invitation through the confirm dialog, sending exactly one request, and refreshes the list', async () => {
    vi.mocked(listInvitations).mockResolvedValueOnce({ outcome: 'ok', invitations: [PENDING_MANAGER] });
    vi.mocked(listInvitations).mockResolvedValueOnce({ outcome: 'ok', invitations: [] });
    vi.mocked(revokeInvitation).mockResolvedValue({ outcome: 'ok' });

    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את ההזמנה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }).at(-1)!);

    await waitFor(() => expect(revokeInvitation).toHaveBeenCalledExactlyOnceWith('inv-1'));
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());
  });

  it('shows a row error and keeps the row when revoke fails, without a second request on repeated clicks while in flight', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [PENDING_MANAGER] });
    let resolveRevoke: (value: Awaited<ReturnType<typeof revokeInvitation>>) => void = () => {};
    vi.mocked(revokeInvitation).mockReturnValue(
      new Promise((resolve) => {
        resolveRevoke = resolve;
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את ההזמנה?' })).toBeInTheDocument());
    const confirmButton = screen.getAllByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }).at(-1)!;
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    resolveRevoke({ outcome: 'unexpected_error' });
    await waitFor(() => expect(screen.getByText('לא הצלחנו לבטל את ההזמנה. נסו שוב.')).toBeInTheDocument());
    expect(revokeInvitation).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('table')).getByText('מנהל')).toBeInTheDocument();
  });

  // CAR-118 review: a revoke racing a redemption reads 409 ALREADY_REDEEMED
  // from the server — a stale row, not an unexpected failure. The row must
  // disappear (it is genuinely no longer pending) with accurate copy, never
  // the generic retry-suggesting error a revoke against it can never satisfy.
  it('removes the row and shows an accurate message, not a generic error, when the invitation was redeemed a moment before the revoke reached the server', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [PENDING_MANAGER] });
    vi.mocked(revokeInvitation).mockResolvedValue({ outcome: 'already_redeemed' });

    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את ההזמנה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }).at(-1)!);

    await waitFor(() =>
      expect(
        screen.getByText('ההזמנה הזו כבר מומשה, ולכן לא נותר מה לבטל — היא הוסרה מרשימת ההזמנות הממתינות.'),
      ).toBeInTheDocument(),
    );
    // Reconciled with server truth — no longer listed as pending, and no
    // lingering row to invite a repeat revoke that could never succeed.
    expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument();
    expect(screen.queryByText('לא הצלחנו לבטל את ההזמנה. נסו שוב.')).not.toBeInTheDocument();
  });

  it('keeps a genuinely unexpected revoke error distinct from the already-redeemed message', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [PENDING_MANAGER] });
    vi.mocked(revokeInvitation).mockResolvedValue({ outcome: 'unexpected_error' });

    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'לבטל את ההזמנה?' })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /ביטול ההזמנה בתפקיד מנהל/ }).at(-1)!);

    await waitFor(() => expect(screen.getByText('לא הצלחנו לבטל את ההזמנה. נסו שוב.')).toBeInTheDocument());
    expect(
      screen.queryByText('ההזמנה הזו כבר מומשה, ולכן לא נותר מה לבטל — היא הוסרה מרשימת ההזמנות הממתינות.'),
    ).not.toBeInTheDocument();
  });

  // CAR-118 review: the create form must stay unreachable for as long as a
  // just-created invitation's one-time link/code are on screen, not only
  // while the create request itself is in flight — otherwise a second click
  // replaces `created` and the first invitation's credential is gone from
  // the UI for good.
  it('keeps the create form disabled while a just-created invitation is still displayed, until it is dismissed', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    await waitFor(() => expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'יצירת הזמנה' })).toBeDisabled();
    expect(screen.getByLabelText('רמת גישה')).toBeDisabled();

    // Two controls share this accessible name — the dialog's own × close
    // button (via `closeLabel`) and the explicit "Done" action inside it —
    // and both dismiss the same way, so either serves this assertion.
    fireEvent.click(screen.getAllByRole('button', { name: 'סיום' }).at(-1)!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'יצירת הזמנה' })).toBeEnabled());
    expect(screen.getByLabelText('רמת גישה')).toBeEnabled();
  });

  // CAR-118 review: the `disabled` attribute is what a real user hits, but
  // `handleCreate` itself must also refuse to run while `created` still holds
  // a displayed credential — not just look disabled. Removing the attribute
  // at the DOM level stands in for "invoked outside the normal disabled-
  // button path" (a stale listener, a non-pointer activation) without
  // fabricating an internal API this component doesn't expose.
  it('refuses to create again while a credential is displayed even if the trigger is invoked outside the disabled button', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());

    const createButton = screen.getByRole('button', { name: 'יצירת הזמנה' });
    fireEvent.click(createButton);
    await waitFor(() => expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument());
    expect(createInvitation).toHaveBeenCalledOnce();

    createButton.removeAttribute('disabled');
    fireEvent.click(createButton);

    expect(createInvitation).toHaveBeenCalledOnce();
    expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument();
  });

  it('renders in Hebrew with RTL by default, and switches to English/LTR copy when the stored language is EN', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });

    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText('הזמנות')).toBeInTheDocument());
    expect(document.documentElement.dir).toBe('rtl');
    unmount();

    window.localStorage.setItem('carma_lang', 'EN');
    renderPage();
    await waitFor(() => expect(screen.getByText('Invitations')).toBeInTheDocument());
    expect(document.documentElement.dir).toBe('ltr');
  });

  // CAR-118 review item 7: the app's own selected UI language, not whatever
  // the test runner's implicit browser locale happens to be — proven by
  // switching the stored language and checking the rendered expiry text
  // actually changes format, not just that some string appears.
  it('formats the pending-list expiry using the selected UI language, not the browser default', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [PENDING_MANAGER] });

    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const hebrewExpiry = new Date(PENDING_MANAGER.expiresAt).toLocaleString('he-IL');
    expect(within(screen.getByRole('table')).getByText(hebrewExpiry)).toBeInTheDocument();
    unmount();

    window.localStorage.setItem('carma_lang', 'EN');
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const englishExpiry = new Date(PENDING_MANAGER.expiresAt).toLocaleString('en-US');
    expect(within(screen.getByRole('table')).getByText(englishExpiry)).toBeInTheDocument();
  });

  it('associates the one-time link and code fields with their own accessible labels', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));

    await waitFor(() => expect(screen.getByLabelText('קישור להזמנה')).toHaveValue(CREATED.url));
    expect(screen.getByLabelText('קוד ההזמנה')).toHaveValue(CREATED.token);
  });

  it('announces clipboard-copy confirmation through a live region', async () => {
    vi.mocked(listInvitations).mockResolvedValue({ outcome: 'ok', invitations: [] });
    vi.mocked(createInvitation).mockResolvedValue({ outcome: 'ok', invitation: CREATED });

    renderPage();
    await waitFor(() => expect(screen.getByText('אין הזמנות ממתינות')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'יצירת הזמנה' }));
    await waitFor(() => expect(screen.getByDisplayValue(CREATED.url)).toBeInTheDocument());

    const copyLinkButton = screen.getByRole('button', { name: 'העתקת הקישור' });
    expect(copyLinkButton).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(copyLinkButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'הועתק' })).toBeInTheDocument());
  });
});
