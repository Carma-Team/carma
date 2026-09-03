import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { RedemptionHistoryPage } from './RedemptionHistoryPage';
import { listRedemptionHistory } from '@/lib/api/redemptionHistory';
import type { RedemptionHistoryEntry } from '@/lib/api/redemptionHistory';
import { listRewards } from '@/lib/api/rewards';
import type { Reward } from '@/lib/api/rewards';

vi.mock('@/lib/api/redemptionHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/redemptionHistory')>();
  return { ...actual, listRedemptionHistory: vi.fn() };
});
vi.mock('@/lib/api/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rewards')>();
  return { ...actual, listRewards: vi.fn() };
});

function reward(overrides: Partial<Reward> = {}): Reward {
  return {
    id: 'r1',
    businessId: 'b1',
    business: 'Biz',
    businessHe: null,
    titleHe: 'שובר קפה',
    titleEn: 'Coffee voucher',
    descriptionHe: 'תיאור',
    descriptionEn: 'Description',
    category: 'food',
    costPoints: 10,
    imageIcon: 'gift-outline',
    isActive: true,
    archivedAt: null,
    stock: null,
    available: null,
    expiresAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<RedemptionHistoryEntry> = {}): RedemptionHistoryEntry {
  return {
    id: 'red-1',
    reward: { id: 'r1', titleHe: 'שובר קפה', titleEn: 'Coffee voucher', imageIcon: 'gift-outline', category: 'food' },
    status: 'used',
    pointsCost: 10,
    createdAt: '2026-08-01T10:00:00Z',
    settledAt: '2026-08-01T10:05:00Z',
    consumedByUserId: 'staff-1',
    consumedByName: 'Dana Levi',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <RedemptionHistoryPage />
    </LanguageProvider>,
  );
}

describe('RedemptionHistoryPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(listRedemptionHistory).mockReset();
    vi.mocked(listRewards).mockReset();
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
  });

  it('shows a loading state, then the table once the first page resolves', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof listRedemptionHistory>>) => void;
    vi.mocked(listRedemptionHistory).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();

    resolve({ outcome: 'ok', redemptions: [entry()], liveVoucherCount: 0, nextCursor: null });

    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no results', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({ outcome: 'ok', redemptions: [], liveVoucherCount: 0, nextCursor: null });

    renderPage();

    await waitFor(() => expect(screen.getByText('לא נמצאו מימושים')).toBeInTheDocument());
  });

  it('shows an error state with a working retry on a load failure', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValueOnce({ outcome: 'unexpected_error' });

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    vi.mocked(listRedemptionHistory).mockResolvedValueOnce({
      outcome: 'ok',
      redemptions: [entry()],
      liveVoucherCount: 0,
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));

    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());
  });

  it('shows a forbidden state distinct from a generic load error', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({ outcome: 'forbidden' });

    renderPage();

    await waitFor(() => expect(screen.getByText('הגישה מוגבלת')).toBeInTheDocument());
  });

  it('defaults to the USED-only status filter, matching the server default', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({ outcome: 'ok', redemptions: [entry()], liveVoucherCount: 0, nextCursor: null });

    renderPage();

    await waitFor(() => expect(listRedemptionHistory).toHaveBeenCalled());
    expect(listRedemptionHistory).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['used'], cursor: null }));
  });

  it('starts a fresh result set — cursor reset, list replaced — when a filter changes', async () => {
    vi.mocked(listRedemptionHistory)
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'used-1' })],
        liveVoucherCount: 0,
        nextCursor: 'cursor-a',
      })
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'expired-1', status: 'expired' })],
        liveVoucherCount: 0,
        nextCursor: null,
      });

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());
    // A next page exists after the first fetch (nextCursor: 'cursor-a').
    expect(screen.getByRole('button', { name: 'טען עוד' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('סטטוס'), { target: { value: 'expired' } });

    await waitFor(() =>
      expect(listRedemptionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['expired'], cursor: null })),
    );
    // The old page's row is gone and the new filter's own single row shows —
    // no leftover rows from the discarded page, and "load more" reflects the
    // new filter's own (null) nextCursor rather than the old one's.
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2)); // header + 1 data row
    expect(screen.getByText('הגעתם לסוף הרשימה.')).toBeInTheDocument();
  });

  it('sends the "all" status filter as every history status, never the live PENDING one', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({ outcome: 'ok', redemptions: [entry()], liveVoucherCount: 0, nextCursor: null });

    renderPage();
    await waitFor(() => expect(listRedemptionHistory).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('סטטוס'), { target: { value: 'all' } });

    await waitFor(() =>
      expect(listRedemptionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['used', 'expired', 'cancelled'] })),
    );
  });

  it('pages through with the server-provided cursor, appending rather than replacing', async () => {
    vi.mocked(listRedemptionHistory)
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'page-1' })],
        liveVoucherCount: 0,
        nextCursor: 'cursor-a',
      })
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'page-2', consumedByName: 'Yossi Cohen' })],
        liveVoucherCount: 0,
        nextCursor: null,
      });

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }));

    await waitFor(() => expect(screen.getByText('Yossi Cohen')).toBeInTheDocument());
    // Both pages' rows are present — appended, not replaced.
    expect(screen.getByText('Dana Levi')).toBeInTheDocument();
    expect(listRedemptionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-a' }));
    // End of results now — the button is gone, replaced by the end marker.
    await waitFor(() => expect(screen.getByText('הגעתם לסוף הרשימה.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'טען עוד' })).not.toBeInTheDocument();
  });

  it('drops a load-more response that resolves after a filter change has already started a fresh fetch', async () => {
    let resolveLoadMore!: (value: Awaited<ReturnType<typeof listRedemptionHistory>>) => void;
    vi.mocked(listRedemptionHistory)
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'page-1' })],
        liveVoucherCount: 0,
        nextCursor: 'cursor-a',
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLoadMore = resolve;
        }),
      )
      .mockResolvedValueOnce({
        outcome: 'ok',
        redemptions: [entry({ id: 'expired-1', status: 'expired' })],
        liveVoucherCount: 0,
        nextCursor: null,
      });

    renderPage();
    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'טען עוד' }));
    // Before the load-more call resolves, the status filter changes — this
    // must win, and the stale load-more response must not land on top of it.
    fireEvent.change(screen.getByLabelText('סטטוס'), { target: { value: 'expired' } });
    await waitFor(() => expect(listRedemptionHistory).toHaveBeenCalledTimes(3));

    resolveLoadMore({ outcome: 'ok', redemptions: [entry({ id: 'stale-page-2' })], liveVoucherCount: 0, nextCursor: null });

    // Only the fresh filter's single row ever shows — the stale page-2 row
    // (and the discarded page-1 row) never appear.
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.queryByText('stale-page-2', { exact: false })).not.toBeInTheDocument();
  });

  it('never renders a driver identifier — only the business staff member CAR-75 attributes the redemption to', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({
      outcome: 'ok',
      redemptions: [entry({ consumedByUserId: 'staff-1', consumedByName: 'Dana Levi' })],
      liveVoucherCount: 0,
      nextCursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Dana Levi')).toBeInTheDocument());
    expect(screen.queryByText('staff-1')).not.toBeInTheDocument();
  });

  it('shows a dash when no business member is attributed to the redemption', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({
      outcome: 'ok',
      redemptions: [entry({ consumedByUserId: null, consumedByName: null })],
      liveVoucherCount: 0,
      nextCursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
  });

  it('renders the reward title and status label in Hebrew by default', async () => {
    vi.mocked(listRedemptionHistory).mockResolvedValue({
      outcome: 'ok',
      redemptions: [
        entry({ reward: { id: 'r1', titleHe: 'שובר קפה', titleEn: 'Coffee voucher', imageIcon: 'gift-outline', category: 'food' } }),
      ],
      liveVoucherCount: 0,
      nextCursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getByText('שובר קפה')).toBeInTheDocument();
    expect(table.getByText('מומש')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('renders the reward title, status label and settled date/time in English once the language preference is EN', async () => {
    window.localStorage.setItem('carma_lang', 'EN');
    vi.mocked(listRedemptionHistory).mockResolvedValue({
      outcome: 'ok',
      redemptions: [
        entry({
          reward: { id: 'r1', titleHe: 'שובר קפה', titleEn: 'Coffee voucher', imageIcon: 'gift-outline', category: 'food' },
          settledAt: '2026-08-01T10:05:00Z',
        }),
      ],
      liveVoucherCount: 0,
      nextCursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Coffee voucher')).toBeInTheDocument();
    expect(table.getByText('Used')).toBeInTheDocument();
    expect(screen.queryByText('שובר קפה')).not.toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
  });
});
