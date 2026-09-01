import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessRequestsReviewPage } from './BusinessRequestsReviewPage';
import { listBusinessRequests, approveBusinessRequest, rejectBusinessRequest } from '@/lib/api/businessRequests';
import type { BusinessRequestAdmin } from '@/lib/api/businessRequests';

vi.mock('@/lib/api/businessRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/businessRequests')>();
  return { ...actual, listBusinessRequests: vi.fn(), approveBusinessRequest: vi.fn(), rejectBusinessRequest: vi.fn() };
});

const PENDING: BusinessRequestAdmin = {
  id: 'r1',
  status: 'pending',
  name: 'Aroma',
  nameHe: 'ארומה',
  category: 'food',
  locationLat: 32.0648,
  locationLng: 34.7748,
  address: 'Rothschild 1, Tel Aviv',
  registrationNumber: 'REG-1',
  contactPerson: 'Dana Cohen',
  phone: '+972501234567',
  createdAt: '2026-08-27T00:00:00Z',
  reviewedAt: null,
  reviewerNote: null,
};

const PENDING_2: BusinessRequestAdmin = {
  ...PENDING,
  id: 'r2',
  name: 'Green Eco Co',
  contactPerson: 'Amir Levi',
  registrationNumber: 'REG-2',
};

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <BusinessRequestsReviewPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('BusinessRequestsReviewPage', () => {
  beforeEach(() => {
    // Default language is Hebrew (see LanguageProvider) — these tests assert
    // on the English copy, same as other page tests that need it (e.g.
    // PermissionsPage.test.tsx's RTL-switch test).
    window.localStorage.setItem('carma_lang', 'EN');
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as (returnValue?: string) => void;
    vi.mocked(listBusinessRequests).mockReset();
    vi.mocked(approveBusinessRequest).mockReset();
    vi.mocked(rejectBusinessRequest).mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('loads the pending filter by default, so pending requests are easy to review first', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [PENDING] });

    renderPage();

    await waitFor(() => expect(listBusinessRequests).toHaveBeenCalledExactlyOnceWith('pending'));
    expect(await screen.findByText('Aroma')).toBeInTheDocument();
  });

  it('shows a loading state before the list resolves', () => {
    vi.mocked(listBusinessRequests).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading requests…')).toBeInTheDocument();
  });

  it('shows the empty state when there are no requests for the current filter', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [] });

    renderPage();

    expect(await screen.findByText('No requests here')).toBeInTheDocument();
  });

  it('shows an error state with retry when loading fails, and retry re-fetches', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'network_error' });
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [PENDING] });

    renderPage();

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());
    expect(listBusinessRequests).toHaveBeenCalledTimes(2);
  });

  it('shows the forbidden state when the server refuses the list', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'forbidden' });

    renderPage();

    expect(await screen.findByText('Only an admin can review business join requests.')).toBeInTheDocument();
  });

  it('re-fetches with the new status filter when the reviewer changes it', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [] });

    renderPage();
    await waitFor(() => expect(listBusinessRequests).toHaveBeenCalledExactlyOnceWith('pending'));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });

    await waitFor(() => expect(listBusinessRequests).toHaveBeenLastCalledWith('approved'));
  });

  it('sends exactly one approve request, reflects the server-returned row, and reconciles the filtered list', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [PENDING] });
    vi.mocked(approveBusinessRequest).mockResolvedValue({
      outcome: 'ok',
      request: { ...PENDING, status: 'approved', reviewedAt: '2026-08-28T00:00:00Z' },
    });
    // The reconcile refetch after a successful decision — under the default
    // 'pending' filter an approved request should drop out of the list.
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));

    await waitFor(() => expect(approveBusinessRequest).toHaveBeenCalledExactlyOnceWith('r1'));
    await waitFor(() => expect(listBusinessRequests).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Aroma')).not.toBeInTheDocument());
  });

  it('disables every action button while one row\'s action is in flight, and shows a busy label only on that row', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [PENDING, PENDING_2] });
    vi.mocked(approveBusinessRequest).mockReturnValue(new Promise(() => {})); // never resolves

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));

    expect(await screen.findByRole('button', { name: 'Approve Aroma' })).toHaveTextContent('Approving…');
    expect(screen.getByRole('button', { name: 'Approve Aroma' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject Aroma' })).toBeDisabled();
    // A different row's controls are disabled too — this app's existing
    // convention (see PermissionsPage) is one mutation in flight at a time
    // across the whole page, not per row.
    expect(screen.getByRole('button', { name: 'Approve Green Eco Co' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Green Eco Co' })).toHaveTextContent('Approve');

    // A second click on the same busy button must not fire a duplicate request.
    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));
    expect(approveBusinessRequest).toHaveBeenCalledOnce();
  });

  it('disables the status filter while a mutation is in flight, so a filter change cannot race the post-decision reconcile', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [PENDING] });
    vi.mocked(approveBusinessRequest).mockReturnValue(new Promise(() => {})); // never resolves

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));

    // `handleApprove`'s eventual `reconcile()` closes over the filter value
    // from this render; disabling the control while it holds means that
    // value can never go stale mid-flight.
    expect(await screen.findByLabelText('Status')).toBeDisabled();
    // Only one fetch so far (the initial load) — a disabled select cannot
    // have fired a second one.
    expect(listBusinessRequests).toHaveBeenCalledOnce();
  });

  it('re-enables the status filter once the in-flight mutation settles', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [PENDING] });
    vi.mocked(approveBusinessRequest).mockResolvedValue({
      outcome: 'ok',
      request: { ...PENDING, status: 'approved', reviewedAt: '2026-08-28T00:00:00Z' },
    });
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));

    await waitFor(() => expect(screen.getByLabelText('Status')).not.toBeDisabled());
  });

  it('shows the server-provided conflict message and reconciles the list when a decision was already made elsewhere', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [PENDING] });
    vi.mocked(approveBusinessRequest).mockResolvedValue({
      outcome: 'conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This request was already rejected',
    });
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({
      outcome: 'ok',
      requests: [{ ...PENDING, status: 'rejected', reviewerNote: 'Missing documents' }],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Approve Aroma' }));

    await waitFor(() => expect(screen.getByText('This request was already rejected')).toBeInTheDocument());
    await waitFor(() => expect(listBusinessRequests).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Missing documents/)).toBeInTheDocument());
  });

  it('requires a reviewer note before a reject can be submitted', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValue({ outcome: 'ok', requests: [PENDING] });

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Reject Aroma' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Reject this request?' })).toBeInTheDocument());

    // The dialog's own confirm button shares its accessible name with the
    // row's reject button (both carry `rejectAriaLabel`) — a real browser
    // makes the row inert while the native <dialog> is modal, same
    // disambiguation-by-position convention as PermissionsPage's revoke
    // confirm dialog uses for its own accessible-name clash.
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject Aroma' }).at(-1)!);

    expect(await screen.findByText('A reviewer note is required to reject a request.')).toBeInTheDocument();
    expect(rejectBusinessRequest).not.toHaveBeenCalled();
  });

  it('rejects with the entered note, sends exactly one request, and reflects the server-returned row', async () => {
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [PENDING] });
    vi.mocked(rejectBusinessRequest).mockResolvedValue({
      outcome: 'ok',
      request: { ...PENDING, status: 'rejected', reviewerNote: 'Missing documents', reviewedAt: '2026-08-28T00:00:00Z' },
    });
    vi.mocked(listBusinessRequests).mockResolvedValueOnce({ outcome: 'ok', requests: [] });

    renderPage();
    await waitFor(() => expect(screen.getByText('Aroma')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Reject Aroma' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Reject this request?' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Reviewer note'), { target: { value: 'Missing documents' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject Aroma' }).at(-1)!);

    await waitFor(() => expect(rejectBusinessRequest).toHaveBeenCalledExactlyOnceWith('r1', 'Missing documents'));
    await waitFor(() => expect(listBusinessRequests).toHaveBeenCalledTimes(2));
  });
});
