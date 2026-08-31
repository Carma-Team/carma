import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { RewardsPage } from './RewardsPage';
import { listRewards, createReward, updateReward, retireReward, getLiveVoucherCount } from '@/lib/api/rewards';
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
    getLiveVoucherCount: vi.fn(),
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
      register: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    } satisfies AuthContextValue);
    vi.mocked(listRewards).mockReset();
    vi.mocked(createReward).mockReset();
    vi.mocked(updateReward).mockReset();
    vi.mocked(retireReward).mockReset();
    vi.mocked(getLiveVoucherCount).mockReset();
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 0 });
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

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, הסר' });
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

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, הסר' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(retireReward).toHaveBeenCalledTimes(1));
    expect(screen.getByText('שובר')).toBeInTheDocument();
    expect(screen.getByText('לא הצלחנו להסיר את ההטבה. נסו שוב.')).toBeInTheDocument();
  });

  it('prevents a duplicate retirement request while one is already in flight', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    let resolveCall: (value: { outcome: 'ok' }) => void = () => {};
    vi.mocked(retireReward).mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    const confirmButton = await screen.findByRole('button', { name: 'כן, הסר' });
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

    const [retireA] = screen.getAllByRole('button', { name: 'הסרה' });
    fireEvent.click(retireA);
    const confirmButton = await screen.findByRole('button', { name: 'כן, הסר' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    // A's DELETE is now in flight. B's own retire button — the only one
    // still carrying the plain "remove" label, A's now reads "removing…" —
    // must already be disabled, so clicking it cannot reassign the
    // still-open confirm dialog away from A.
    const retireB = screen.getByRole('button', { name: 'הסרה' });
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
    expect(screen.getByRole('button', { name: 'הסרה' })).not.toBeDisabled();
  });

  // ── CAR-115: warn before removing a reward with live vouchers ──────────

  it('fetches the real live-voucher count and warns with it, plural phrasing, before allowing removal', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 3 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    await waitFor(() => expect(getLiveVoucherCount).toHaveBeenCalledWith('r1'));

    expect(
      await screen.findByText(
        'להטבה הזו יש כרגע 3 שוברים חיים. הם כבר הונפקו, ולכן יישארו בתוקף עד לתאריך התפוגה שלהם, גם לאחר הסרת ההטבה.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/דקות|ימים|days|minutes/)).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, הסר' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });

  it('uses singular phrasing for exactly one live voucher', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));

    expect(
      await screen.findByText('להטבה הזו יש כרגע שובר חי אחד. הוא כבר הונפק, ולכן יישאר בתוקף עד לתאריך התפוגה שלו, גם לאחר הסרת ההטבה.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/דקות|ימים|days|minutes/)).not.toBeInTheDocument();
  });

  it('shows a plain confirmation, no voucher warning, when the live-voucher count is zero', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));

    expect(await screen.findByText('ההטבה תפסיק להופיע לנהגים. שוברים שכבר הונפקו עבורה לא ייפגעו.')).toBeInTheDocument();
    expect(screen.queryByText(/שוברים חיים/)).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, הסר' });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
  });

  it('keeps the confirm button disabled and shows an error when the live-voucher count fails to load, with no way to remove anyway', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'network_error' });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));

    const alert = await screen.findByText('לא הצלחנו לבדוק אם יש שוברים חיים. נסו שוב.');
    expect(alert).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'כן, הסר' });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(retireReward).not.toHaveBeenCalled();
  });

  it('cancels the retire confirmation without calling retireReward', async () => {
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 2 });
    renderPage();
    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));
    await screen.findByText(/שוברים חיים/);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(screen.queryByRole('button', { name: 'כן, הסר' })).not.toBeInTheDocument();
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

    const [retireA] = screen.getAllByRole('button', { name: 'הסרה' });
    fireEvent.click(retireA);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    const [, retireB] = screen.getAllByRole('button', { name: 'הסרה' });
    fireEvent.click(retireB);
    await screen.findByText('ההטבה תפסיק להופיע לנהגים. שוברים שכבר הונפקו עבורה לא ייפגעו.');

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
    expect(screen.getByRole('button', { name: 'כן, הסר' })).not.toBeDisabled();
  });

  it('renders the live-voucher warning correctly in English', async () => {
    window.localStorage.setItem('carma_lang', 'EN');
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    vi.mocked(getLiveVoucherCount).mockResolvedValue({ outcome: 'ok', liveVouchers: 4 });
    renderPage();
    await waitFor(() => expect(screen.getByText('Voucher')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      await screen.findByText(
        'This reward has 4 live vouchers right now. They were already issued, so they will stay valid until their own expiry dates, even after you remove the reward.',
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
      register: vi.fn(),
      logout: vi.fn(),
      retry: vi.fn(),
    } satisfies AuthContextValue);
    vi.mocked(listRewards).mockResolvedValue({ outcome: 'ok', rewards: [reward()] });
    renderPage();

    await waitFor(() => expect(screen.getByText('שובר')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'הטבה חדשה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הסרה' })).not.toBeInTheDocument();
  });

  it('shows a CASHIER a view-only empty state, not the create-oriented copy', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { ...USER, businessMembershipRole: 'CASHIER' },
      login: vi.fn(),
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
});
