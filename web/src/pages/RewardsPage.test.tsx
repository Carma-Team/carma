import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { RewardsPage } from './RewardsPage';
import {
  listRewards,
  createReward,
  updateReward,
  retireReward,
  setRewardActive,
  getLiveVoucherCount,
  trashReward,
  restoreRewardFromTrash,
  reactivateReward,
  deleteRewardPermanently,
} from '@/lib/api/rewards';
import type { Reward } from '@/lib/api/rewards';
import { useAuth } from '@/hooks/useAuth';
import type { AuthContextValue, AuthUser } from '@/lib/auth/types';

vi.mock('@/lib/api/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rewards')>();
  return {
    ...actual,
    listRewards: vi.fn(),
    createReward: vi.fn(),
    updateReward: vi.fn(),
    retireReward: vi.fn(),
    setRewardActive: vi.fn(),
    getLiveVoucherCount: vi.fn(),
    trashReward: vi.fn(),
    restoreRewardFromTrash: vi.fn(),
    reactivateReward: vi.fn(),
    deleteRewardPermanently: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth');

const USER: AuthUser = {
  id: '1',
  name: null,
  email: null,
  role: 'BUSINESS',
  businessId: 'b1',
  businessCategory: 'food',
  businessName: null,
  businessNameHe: null,
  businessMembershipRole: 'OWNER',
  businessMembershipAmbiguous: false,
};

function reward(overrides: Partial<Reward> = {}): Reward {
  return {
    id: 'r1',
    businessId: 'b1',
    business: 'Biz',
    businessHe: null,
    titleHe: 'שובר',
    titleEn: 'Voucher',
    descriptionHe: 'תיאור',
    descriptionEn: 'Description',
    category: 'food',
    costPoints: 10,
    imageIcon: 'gift-outline',
    isActive: true,
    archivedAt: null,
    trashedAt: null,
    stock: null,
    available: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <RewardsPage />
    </LanguageProvider>,
  );
}

describe('RewardsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }) as unknown as () => void;
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: USER,
      login: vi.fn(),
      loginWithOtp: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    } satisfies AuthContextValue);
    vi.mocked(listRewards).mockReset();
    vi.mocked(createReward).mockReset();
    vi.mocked(updateReward).mockReset();
    vi.mocked(retireReward).mockReset();
    vi.mocked(setRewardActive).mockReset();
    vi.mocked(getLiveVoucherCount).mockReset();
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 0 });
    vi.mocked(trashReward).mockReset();
    vi.mocked(restoreRewardFromTrash).mockReset();
    vi.mocked(reactivateReward).mockReset();
    vi.mocked(deleteRewardPermanently).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state while the list is in flight', async () => {
    vi.mocked(listRewards).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a recoverable error state with retry when the list fails to load', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'network_error' });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });
    fireEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));

    await waitFor(() => expect(listRewards).toHaveBeenCalledTimes(2));
  });

  it('renders a recoverable state, not a crash, on an unexpected 403', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'forbidden' });
    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'הטבה חדשה' })).not.toBeInTheDocument();
  });

  it('shows an empty state when the business has no rewards', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText('עדיין אין הטבות')).toBeInTheDocument());
  });

  it('renders active, sold-out and expired rewards as visibly distinct states', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [
        reward({ id: 'active', stock: 5, available: 2 }),
        reward({ id: 'sold-out', stock: 5, available: 0 }),
        reward({ id: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' }),
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getAllByText(/^(פעילה|אזל המלאי|פגה תוקף)$/)).toHaveLength(3));
    expect(screen.getByText('פעילה')).toBeInTheDocument();
    expect(screen.getByText('אזל המלאי')).toBeInTheDocument();
    expect(screen.getByText('פגה תוקף')).toBeInTheDocument();
  });

  it('displays unlimited allocation distinctly from a numeric one', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'unlimited', stock: null, available: null }), reward({ id: 'limited', stock: 5, available: 3 })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('ללא הגבלה')).toBeInTheDocument());
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });

  it('never shows an archived reward, even right after loading it', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'archived', archivedAt: '2026-01-01T00:00:00.000Z' })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('עדיין אין הטבות')).toBeInTheDocument());
  });

  it('calls createReward exactly once and adds the new reward to the list', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });
    const created = reward({ id: 'new', titleHe: 'קפה חינם', titleEn: 'Free coffee' });
    vi.mocked(createReward).mockResolvedValue({ outcome: 'ok', reward: created });
    renderPage();
    await waitFor(() => expect(screen.getByText('עדיין אין הטבות')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הטבה חדשה' }));
    fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'קפה חינם' } });
    fireEvent.change(screen.getByLabelText('כותרת (אנגלית)'), { target: { value: 'Free coffee' } });
    fireEvent.change(screen.getByLabelText('תיאור (עברית)'), { target: { value: 'תיאור' } });
    fireEvent.change(screen.getByLabelText('תיאור (אנגלית)'), { target: { value: 'Description' } });
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('תאריך תפוגה'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createReward).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: 'קפה חינם' })).toBeInTheDocument();
  });

  it('retires a reward successfully and removes it from the visible list', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(retireReward).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(retireReward).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('שובר')).not.toBeInTheDocument());
  });

  it('keeps the reward visible with an error when retirement fails', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(retireReward).mockResolvedValue({ outcome: 'network_error' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(retireReward).toHaveBeenCalledTimes(1));
    expect(screen.getByText('שובר')).toBeInTheDocument();
    expect(screen.getByText('לא הצלחנו להעביר את ההטבה לארכיון. נסו שוב.')).toBeInTheDocument();
  });

  it('prevents a duplicate retirement request while one is already in flight', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    let resolveCall: (value: { outcome: 'ok' }) => void = () => {};
    vi.mocked(retireReward).mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    resolveCall({ outcome: 'ok' });
    await waitFor(() => expect(retireReward).toHaveBeenCalledTimes(1));
  });

  // CAR-202 pre-commit review, B3: reward A confirmed and in flight, then
  // the user interacts with a completely different reward B.
  it('keeps reward B untouched while reward A is being retired — no confirmation is silently dismissed', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'a', titleHe: 'הטבה א' }), reward({ id: 'b', titleHe: 'הטבה ב' })],
    });
    let resolveA: (value: { outcome: 'ok' }) => void = () => {};
    vi.mocked(retireReward).mockReturnValue(new Promise((resolve) => (resolveA = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByText('הטבה א')).toBeInTheDocument());

    const [retireA] = screen.getAllByRole('button', { name: 'ארכיון' });
    fireEvent.click(retireA);
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    // A's DELETE is now in flight. B's own retire button — the only one
    // still carrying the plain "remove" label, A's now reads "removing…" —
    // must already be disabled, so clicking it cannot reassign the
    // still-open confirm dialog away from A.
    const retireB = screen.getByRole('button', { name: 'ארכיון' });
    expect(retireB).toBeDisabled();
    fireEvent.click(retireB);
    expect(retireReward).toHaveBeenCalledTimes(1);
    expect(retireReward).toHaveBeenCalledWith('a');

    resolveA({ outcome: 'ok' });
    await waitFor(() => expect(screen.queryByText('הטבה א')).not.toBeInTheDocument());

    // B was never touched by any of this — still visible, never sent to
    // retireReward — and its own retire button works normally again now
    // that nothing is in flight.
    expect(screen.getByText('הטבה ב')).toBeInTheDocument();
    expect(retireReward).toHaveBeenCalledTimes(1);
    expect(retireReward).not.toHaveBeenCalledWith('b');
    expect(screen.getByRole('button', { name: 'ארכיון' })).not.toBeDisabled();
  });

  // ── CAR-115: warn before removing a reward with live vouchers ──────────

  it('fetches the real live-voucher count and warns with it, plural phrasing, before allowing removal', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 3 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    await waitFor(() => expect(getLiveVoucherCount).toHaveBeenCalledWith('r1'));

    expect(
      await screen.findByText(
        'להטבה הזו יש כרגע 3 שוברים חיים. הם כבר הונפקו, ולכן יישארו בתוקף עד לתאריך התפוגה שלהם, גם לאחר העברת ההטבה לארכיון.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/דקות|ימים|days|minutes/)).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });

  it('uses singular phrasing for exactly one live voucher', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));

    expect(
      await screen.findByText('להטבה הזו יש כרגע שובר חי אחד. הוא כבר הונפק, ולכן יישאר בתוקף עד לתאריך התפוגה שלו, גם לאחר העברת ההטבה לארכיון.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/דקות|ימים|days|minutes/)).not.toBeInTheDocument();
  });

  it('shows a plain confirmation, no voucher warning, when the live-voucher count is zero', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));

    expect(await screen.findByText('ההטבה תפסיק להופיע לנהגים. שום דבר לא נמחק — שוברים שכבר הונפקו עבורה לא ייפגעו, וההיסטוריה שלה נשמרת.')).toBeInTheDocument();
    expect(screen.queryByText(/שוברים חיים/)).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });

  it('keeps the confirm button disabled and shows an error when the live-voucher count fails to load, with no way to remove anyway', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'network_error' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));

    const alert = await screen.findByText('לא הצלחנו לבדוק אם יש שוברים חיים. נסו שוב.');
    expect(alert).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, העבר לארכיון' });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(retireReward).not.toHaveBeenCalled();
  });

  it('cancels the retire confirmation without calling retireReward', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 2 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    await screen.findByText(/שוברים חיים/);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(screen.queryByRole('button', { name: 'כן, העבר לארכיון' })).not.toBeInTheDocument();
    expect(retireReward).not.toHaveBeenCalled();
    expect(screen.getByText('שובר')).toBeInTheDocument();
  });

  it('never lets a slow, stale voucher-count response from a cancelled dialog leak into the next reward opened', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'a', titleHe: 'הטבה א' }), reward({ id: 'b', titleHe: 'הטבה ב' })],
    });
    let resolveA: (value: { outcome: 'ok'; liveVouchers: number }) => void = () => {};
    vi.mocked(getLiveVoucherCount).mockImplementation((rewardId: string) => {
      if (rewardId === 'a') return new Promise((resolve) => (resolveA = resolve));
      return Promise.resolve({ outcome: 'ok', liveVouchers: 0 });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('הטבה א')).toBeInTheDocument());

    const [retireA] = screen.getAllByRole('button', { name: 'ארכיון' });
    fireEvent.click(retireA);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    const [, retireB] = screen.getAllByRole('button', { name: 'ארכיון' });
    fireEvent.click(retireB);
    await screen.findByText('ההטבה תפסיק להופיע לנהגים. שום דבר לא נמחק — שוברים שכבר הונפקו עבורה לא ייפגעו, וההיסטוריה שלה נשמרת.');

    // A's request resolves only now, well after B's dialog is already showing
    // its own (zero-voucher) result — it must not overwrite B's state. `act`
    // flushes the microtask queue so the (guarded-against) state update this
    // resolution would otherwise trigger has actually had a chance to run
    // before the assertions below check for it.
    await act(async () => {
      resolveA({ outcome: 'ok', liveVouchers: 5 });
      await Promise.resolve();
    });
    expect(screen.queryByText(/שוברים חיים/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'כן, העבר לארכיון' })).not.toBeDisabled();
  });

  it('renders the live-voucher warning correctly in English', async () => {
    window.localStorage.setItem('carma_lang', 'EN');
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 4 });
    renderPage();
    await waitFor(() => expect(screen.getByText('Voucher')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(
      await screen.findByText(
        'This reward has 4 live vouchers right now. They were already issued, so they will stay valid until their own expiry dates, even after you archive the reward.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/minutes|days/)).not.toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
  });

  // ── blank/whitespace legacy translations (N6) ──────────────────────────

  // ── CAR-116: CASHIER gets the view granted by the matrix, none of the rest ──

  it('shows a CASHIER the active rewards the server sent, with no create/edit/retire controls', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { ...USER, businessMembershipRole: 'CASHIER' },
      login: vi.fn(),
      loginWithOtp: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    } satisfies AuthContextValue);
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    renderPage();

    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'הטבה חדשה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ארכיון' })).not.toBeInTheDocument();
  });

  it('shows a CASHIER a view-only empty state, not the create-oriented copy', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { ...USER, businessMembershipRole: 'CASHIER' },
      login: vi.fn(),
      loginWithOtp: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    } satisfies AuthContextValue);
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText('אין כרגע הטבות זמינות.')).toBeInTheDocument());
    expect(screen.queryByText('צרו את ההטבה הראשונה שלכם כדי להציע אותה לחברי כרמה.')).not.toBeInTheDocument();
  });

  it('falls back to Hebrew when the English title and description are blank/whitespace, rather than rendering an empty card', async () => {
    window.localStorage.setItem('carma_lang', 'EN');
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [
        reward({
          id: 'blank-en',
          titleHe: 'כותרת עברית',
          titleEn: '   ',
          descriptionHe: 'תיאור עברי',
          descriptionEn: '',
        }),
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'כותרת עברית' })).toBeInTheDocument());
    expect(screen.getByText('תיאור עברי')).toBeInTheDocument();
  });

  it('renders a reward with no description in either language without a blank paragraph or literal null/undefined', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'no-desc', titleHe: 'כותרת', descriptionHe: null, descriptionEn: null })],
    });
    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'כותרת' })).toBeInTheDocument());
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    // No empty paragraph left behind where the description would have gone —
    // every other <p> on the card (category, cost, allocation) always has text.
    expect(Array.from(document.querySelectorAll('p')).every((p) => p.textContent?.trim() !== '')).toBe(true);
  });

  // ── CAR-339: pause/resume, tabs, search ──────────────────────────────────

  it('pauses an active reward and flips its card to the resume action', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ isActive: true })] });
    vi.mocked(setRewardActive).mockResolvedValue({ outcome: 'ok', reward: reward({ isActive: false }) });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'השהיה' }));

    await waitFor(() => expect(setRewardActive).toHaveBeenCalledWith('r1', false));
    expect(await screen.findByRole('button', { name: 'החזרה לפעילות' })).toBeInTheDocument();
  });

  it('resumes a paused reward', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ isActive: false })] });
    vi.mocked(setRewardActive).mockResolvedValue({ outcome: 'ok', reward: reward({ isActive: true }) });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'החזרה לפעילות' }));

    await waitFor(() => expect(setRewardActive).toHaveBeenCalledWith('r1', true));
    expect(await screen.findByRole('button', { name: 'השהיה' })).toBeInTheDocument();
  });

  it('shows an error and keeps the reward as-is when pausing fails', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ isActive: true })] });
    vi.mocked(setRewardActive).mockResolvedValue({ outcome: 'network_error' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'השהיה' }));

    await waitFor(() => expect(screen.getByText('לא הצלחנו להשהות את ההטבה. נסו שוב.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'השהיה' })).toBeInTheDocument();
  });

  it('filters the list down to paused rewards when the Paused tab is selected', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'a', titleHe: 'הטבה פעילה', isActive: true }), reward({ id: 'b', titleHe: 'הטבה מושהית', isActive: false })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('הטבה פעילה')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^מושהות/ }));

    expect(screen.queryByText('הטבה פעילה')).not.toBeInTheDocument();
    expect(screen.getByText('הטבה מושהית')).toBeInTheDocument();
  });

  it('shows an Archived tab that is the only way to see an archived reward', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'a', titleHe: 'הטבה חיה' }), reward({ id: 'b', titleHe: 'הטבה בארכיון', archivedAt: '2026-01-01T00:00:00.000Z' })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('הטבה חיה')).toBeInTheDocument());

    expect(screen.queryByText('הטבה בארכיון')).not.toBeInTheDocument();

    // The tab bar renders before any card, so it's the first "ארכיון…"
    // button — the second is the visible card's own per-reward archive
    // action, which this query would otherwise also match.
    const [archivedTab] = screen.getAllByRole('button', { name: /^ארכיון/ });
    fireEvent.click(archivedTab);

    expect(screen.queryByText('הטבה חיה')).not.toBeInTheDocument();
    expect(screen.getByText('הטבה בארכיון')).toBeInTheDocument();
    // No lifecycle action is offered on an archived reward — there is no
    // restore endpoint (see PR notes), and CAR-339 does not add one.
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'השהיה' })).not.toBeInTheDocument();
    // Only the tab bar's own "ארכיון…" button is left once the visible
    // card is the archived one, with no per-card archive action of its own.
    expect(screen.getAllByRole('button', { name: /^ארכיון/ })).toHaveLength(1);
  });

  it('makes a just-archived reward appear under the Archived tab immediately, with consistent tab counts, and no remount or refetch', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'a', titleHe: 'הטבה לארכוב' })],
    });
    vi.mocked(retireReward).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    await waitFor(() => expect(screen.getByText('הטבה לארכוב')).toBeInTheDocument());

    // Before archiving: one reward under "All", none under "Archived".
    expect(screen.getByRole('button', { name: 'הכל 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ארכיון 0' })).toBeInTheDocument();

    // The per-card action's accessible name is the bare label — the tab's
    // own "ארכיון 0" carries a count, so this exact match can't collide.
    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(retireReward).toHaveBeenCalledWith('a'));
    // Still on the default "All" tab, which excludes archived rewards by
    // definition — the reward should already be gone from view here.
    await waitFor(() => expect(screen.queryByText('הטבה לארכוב')).not.toBeInTheDocument());

    // The counts update from the same local state change — no second
    // `listRewards` call, i.e. no refetch, was needed to get here.
    expect(listRewards).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'הכל 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ארכיון 1' })).toBeInTheDocument();

    // Switching tabs — no remount of RewardsPage — reveals it right away.
    fireEvent.click(screen.getByRole('button', { name: 'ארכיון 1' }));
    expect(screen.getByText('הטבה לארכוב')).toBeInTheDocument();
  });

  it('filters the visible rewards by search text, matching either language', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [
        reward({ id: 'a', titleHe: 'קפה גדול', titleEn: 'Large coffee' }),
        reward({ id: 'b', titleHe: 'שטיפת רכב', titleEn: 'Car wash' }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('קפה גדול')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('חיפוש הטבה'), { target: { value: 'coffee' } });

    expect(screen.getByText('קפה גדול')).toBeInTheDocument();
    expect(screen.queryByText('שטיפת רכב')).not.toBeInTheDocument();
  });

  it('shows the total (archived excluded) and active counts in the header subtitle', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [
        reward({ id: 'a', isActive: true }),
        reward({ id: 'b', isActive: false }),
        reward({ id: 'c', archivedAt: '2026-01-01T00:00:00.000Z' }),
      ],
    });
    renderPage();

    expect(await screen.findByText('2 הטבות · 1 פעילות')).toBeInTheDocument();
  });

  it('shows a "no results" empty state for a search that matches nothing, distinct from having no rewards at all', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ titleHe: 'קפה', titleEn: 'Coffee' })] });
    renderPage();
    await waitFor(() => expect(screen.getByText('קפה')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('חיפוש הטבה'), { target: { value: 'zzz' } });

    expect(await screen.findByText('לא נמצאו הטבות')).toBeInTheDocument();
    expect(screen.getByText('נסו חיפוש או סינון אחר.')).toBeInTheDocument();
  });

  it('shows an "archive is empty" message on the Archived tab when nothing is archived yet', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    const [archivedTab] = screen.getAllByRole('button', { name: /^ארכיון/ });
    fireEvent.click(archivedTab);

    expect(await screen.findByText('הארכיון ריק כרגע.')).toBeInTheDocument();
  });

  // ── CAR-339 review follow-up: cross-action guard, tab a11y, sold-out CTA ──

  it('disables the archive action while a pause/resume toggle is in flight for the same (only) reward', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ isActive: true })] });
    let resolveToggle: (value: { outcome: 'ok'; reward: Reward }) => void = () => {};
    vi.mocked(setRewardActive).mockReturnValue(new Promise((resolve) => (resolveToggle = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'השהיה' }));

    expect(screen.getByRole('button', { name: 'ארכיון' })).toBeDisabled();

    await act(async () => {
      resolveToggle({ outcome: 'ok', reward: reward({ isActive: false }) });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'ארכיון' })).not.toBeDisabled();
  });

  it('disables pause/resume while an archive confirmation is in flight for the same (only) reward', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward({ isActive: true })] });
    let resolveRetire: (value: { outcome: 'ok' }) => void = () => {};
    vi.mocked(retireReward).mockReturnValue(new Promise((resolve) => (resolveRetire = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ארכיון' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, העבר לארכיון' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    expect(screen.getByRole('button', { name: 'השהיה' })).toBeDisabled();

    await act(async () => {
      resolveRetire({ outcome: 'ok' });
      await Promise.resolve();
    });
    expect(retireReward).toHaveBeenCalledWith('r1');
  });

  it('marks the currently selected lifecycle tab with aria-current for assistive technology', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'הכל 1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'פעילות 1' })).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'פעילות 1' }));

    expect(screen.getByRole('button', { name: 'הכל 1' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'פעילות 1' })).toHaveAttribute('aria-current', 'true');
  });

  it("gives the sold-out reward's \"add stock\" action primary visual emphasis, unlike the plain Edit action", async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ id: 'active', stock: 5, available: 2 }), reward({ id: 'soldout', stock: 5, available: 0 })],
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('שובר')).toHaveLength(2));

    const editButton = screen.getByRole('button', { name: 'עריכה' });
    const addStockButton = screen.getByRole('button', { name: 'הוספת מלאי' });
    expect(editButton.className).not.toMatch(/primary/);
    expect(addStockButton.className).toMatch(/primary/);
  });

  // ── Trash / restore / reactivate / permanent delete ─────────────────────

  it('trashes an active reward and moves it under the Trash tab, not Archived', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(trashReward).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'העברה לאשפה' }));
    expect(await screen.findByText('ההטבה תיעלם מכל התצוגות מלבד האשפה. תוכלו לשחזר אותה לארכיון מאוחר יותר, או למחוק אותה משם לצמיתות — שוברים שכבר הונפקו לא ייפגעו.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'כן, העבר לאשפה' }));
    await waitFor(() => expect(trashReward).toHaveBeenCalledWith('r1'));

    // Tab bar renders before the cards, so the first "אשפה…"/"ארכיון…" match
    // is always the tab itself.
    const [trashTab] = screen.getAllByRole('button', { name: /^אשפה/ });
    fireEvent.click(trashTab);
    expect(await screen.findByText('שובר')).toBeInTheDocument();

    const [archivedTab] = screen.getAllByRole('button', { name: /^ארכיון/ });
    fireEvent.click(archivedTab);
    expect(screen.queryByText('שובר')).not.toBeInTheDocument();
  });

  it('keeps the trash confirm button disabled and shows a blocked message while a voucher is live', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'העברה לאשפה' }));
    expect(await screen.findByText(/שובר חי אחד/)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'כן, העבר לאשפה' });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(trashReward).not.toHaveBeenCalled();
  });

  it('reactivates an archived reward back to Active, without going through Trash', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ archivedAt: '2026-01-01T00:00:00.000Z' })],
    });
    vi.mocked(reactivateReward).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    const [archivedTab] = await screen.findAllByRole('button', { name: /^ארכיון/ });
    fireEvent.click(archivedTab);
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הפעלה מחדש' }));
    await waitFor(() => expect(reactivateReward).toHaveBeenCalledWith('r1'));

    const [activeTab] = screen.getAllByRole('button', { name: /^פעילות/ });
    fireEvent.click(activeTab);
    expect(await screen.findByText('שובר')).toBeInTheDocument();
  });

  it('restores a trashed reward to Archive, not Active, and shows a success banner', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ archivedAt: '2026-01-01T00:00:00.000Z', trashedAt: '2026-01-02T00:00:00.000Z' })],
    });
    vi.mocked(restoreRewardFromTrash).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    const [trashTab] = await screen.findAllByRole('button', { name: /^אשפה/ });
    fireEvent.click(trashTab);
    await waitFor(() => expect(screen.getByText('שחזור לארכיון')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'שחזור לארכיון' }));
    await waitFor(() => expect(restoreRewardFromTrash).toHaveBeenCalledWith('r1'));

    expect(await screen.findByText('ההטבה שוחזרה לארכיון.')).toBeInTheDocument();
    // Landed in Archive, not Active — the reward still needs an explicit
    // reactivate before it can reappear in the marketplace.
    expect(screen.getByRole('button', { name: 'הפעלה מחדש' })).toBeInTheDocument();
  });

  it('permanently deletes a trashed reward after confirmation, and it disappears from every tab', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ archivedAt: '2026-01-01T00:00:00.000Z', trashedAt: '2026-01-02T00:00:00.000Z' })],
    });
    vi.mocked(deleteRewardPermanently).mockResolvedValue({ outcome: 'ok' });
    renderPage();
    const [trashTab] = await screen.findAllByRole('button', { name: /^אשפה/ });
    fireEvent.click(trashTab);
    await waitFor(() => expect(screen.getByText('מחיקה לצמיתות')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'מחיקה לצמיתות' }));
    expect(await screen.findByText('למחוק את ההטבה לצמיתות?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'כן, מחק לצמיתות' }));
    await waitFor(() => expect(deleteRewardPermanently).toHaveBeenCalledWith('r1'));

    // It was the only reward, so deleting it permanently empties the catalog
    // outright — the tab bar disappears along with it, confirming the
    // reward is gone from every tab rather than merely the one open now.
    expect(await screen.findByText('עדיין אין הטבות')).toBeInTheDocument();
    expect(screen.queryByText('שובר')).not.toBeInTheDocument();
  });

  it('keeps the reward visible with an error when permanent delete fails', async () => {
    vi.mocked(listRewards).mockResolvedValue({
      outcome: 'ok',
      rewards: [reward({ archivedAt: '2026-01-01T00:00:00.000Z', trashedAt: '2026-01-02T00:00:00.000Z' })],
    });
    vi.mocked(deleteRewardPermanently).mockResolvedValue({ outcome: 'unexpected_error' });
    renderPage();
    const [trashTab] = await screen.findAllByRole('button', { name: /^אשפה/ });
    fireEvent.click(trashTab);
    await waitFor(() => expect(screen.getByText('מחיקה לצמיתות')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'מחיקה לצמיתות' }));
    fireEvent.click(await screen.findByRole('button', { name: 'כן, מחק לצמיתות' }));

    expect(await screen.findByText('לא הצלחנו למחוק את ההטבה. נסו שוב.')).toBeInTheDocument();
    expect(screen.getByText('שובר')).toBeInTheDocument();
  });
});
