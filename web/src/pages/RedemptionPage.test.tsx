import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { RedemptionPage } from './RedemptionPage';
import { peekVoucher, consumeVoucher } from '@/lib/api/vouchers';
import type { Voucher, VoucherResult } from '@/lib/api/vouchers';

vi.mock('@/lib/api/vouchers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/vouchers')>();
  return { ...actual, peekVoucher: vi.fn(), consumeVoucher: vi.fn() };
});

const REWARD = {
  id: 'r1',
  businessId: 'b1',
  business: 'Biz',
  businessHe: null,
  titleHe: 'קפה גדול חינם',
  titleEn: 'Free large coffee',
  descriptionHe: 'תיאור',
  descriptionEn: null,
  category: 'food',
  costPoints: 120,
  imageIcon: 'coffee',
  isActive: true,
  archivedAt: null,
  trashedAt: null,
  stock: null,
  available: null,
  expiresAt: null,
};

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    rewardId: 'r1',
    code: 'TXQ947ZKPS',
    qrData: 'TXQ947ZKPS',
    status: 'pending',
    isUsed: false,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    redeemedAt: null,
    createdAt: new Date().toISOString(),
    pointsCost: 120,
    reward: REWARD,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <RedemptionPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

async function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));
  // Waits for the peeking step's spinner (role="status") to clear rather than
  // for a heading — a peeked voucher can land on either the review card
  // (a heading) or the failure card (an alert, no heading), so this has to
  // work for both.
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
}

describe('RedemptionPage', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
    HTMLDialogElement.prototype.close = close as unknown as (returnValue?: string) => void;
    vi.mocked(peekVoucher).mockReset();
    vi.mocked(consumeVoucher).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the review step from a peek result without calling consume', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });

    renderPage();
    await enterCode('TXQ947ZKPS');

    expect(screen.getByRole('heading', { name: 'קפה גדול חינם' })).toBeInTheDocument();
    expect(consumeVoucher).not.toHaveBeenCalled();
  });

  it('sends exactly one consume request when confirmation is clicked', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });

    renderPage();
    await enterCode('TXQ947ZKPS');

    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).toBeInTheDocument());
    expect(consumeVoucher).toHaveBeenCalledTimes(1);
    expect(consumeVoucher).toHaveBeenCalledWith('TXQ947ZKPS');
  });

  it('does not send a second consume request on a double click', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    let resolveConsume!: (result: VoucherResult) => void;
    vi.mocked(consumeVoucher).mockReturnValue(new Promise((resolve) => (resolveConsume = resolve)));

    renderPage();
    await enterCode('TXQ947ZKPS');

    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    const confirmButton = screen.getByRole('button', { name: 'כן, מימוש ההטבה' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    resolveConsume({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).toBeInTheDocument());

    expect(consumeVoucher).toHaveBeenCalledTimes(1);
  });

  it('accepts a code typed with lowercase, spaces and hyphens and reaches the review step', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });

    renderPage();
    await enterCode('  txq-947z kps ');

    expect(peekVoucher).toHaveBeenCalledWith('  txq-947z kps ');
    expect(screen.getByRole('heading', { name: 'קפה גדול חינם' })).toBeInTheDocument();
  });

  it('shows a visible, accurate TTL countdown that ticks down on the review step', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ expiresAt }) });

    renderPage();
    fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));
    // flush the mocked async peekVoucher without real timers
    await vi.waitFor(() => expect(screen.getByText('5:00')).toBeInTheDocument());

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(screen.getByText('4:00')).toBeInTheDocument());

    vi.useRealTimers();
  });

  it('shows the already-used failure card for a voucher peeked back as already used, without offering redemption', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });

    renderPage();
    await enterCode('TXQ947ZKPS');

    expect(screen.getByText('השובר כבר מומש')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'מימוש ההטבה' })).not.toBeInTheDocument();
    expect(consumeVoucher).not.toHaveBeenCalled();
  });

  it('leaves the page recoverable, not stuck, when consume fails after a successful lookup', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'already_used' });

    renderPage();
    await enterCode('TXQ947ZKPS');
    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).not.toBeInTheDocument();

    // Not stuck: the failure offers a way back to code entry.
    fireEvent.click(screen.getByRole('button', { name: 'הזנת קוד אחר' }));
    expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument();
  });

  it('renders in Hebrew RTL by default', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });

    renderPage();

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'מימוש הטבה' })).toBeInTheDocument();
    expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument();
  });

  it('renders in English LTR when the language is switched', async () => {
    window.localStorage.setItem('carma_lang', 'EN');
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });

    renderPage();

    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('heading', { name: 'Redeem a reward' })).toBeInTheDocument();
    expect(screen.getByLabelText('Voucher code')).toBeInTheDocument();
  });

  // ── confirmation cannot be escaped or restarted while consume is pending ──

  it('cannot be exited via Escape, the dialog close control, or the cancel button while a consume request is pending', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    let resolveConsume!: (result: VoucherResult) => void;
    vi.mocked(consumeVoucher).mockReturnValue(new Promise((resolve) => (resolveConsume = resolve)));

    renderPage();
    await enterCode('TXQ947ZKPS');
    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

    // consume is now pending — try every way out of the dialog.
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' })); // Dialog's own "x"
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); // our Cancel button

    // still mid-flow: neither back at entry nor falsely at success.
    expect(screen.queryByLabelText('קוד שובר')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).not.toBeInTheDocument();
    expect(consumeVoucher).toHaveBeenCalledTimes(1);

    resolveConsume({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).toBeInTheDocument());
    // None of the escape attempts sent a second consume request.
    expect(consumeVoucher).toHaveBeenCalledTimes(1);
  });

  it('cannot send a second consume request via closing the dialog, returning to entry, or reopening it', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    let resolveConsume!: (result: VoucherResult) => void;
    vi.mocked(consumeVoucher).mockReturnValue(new Promise((resolve) => (resolveConsume = resolve)));

    renderPage();
    await enterCode('TXQ947ZKPS');
    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    const confirmYes = screen.getByRole('button', { name: 'כן, מימוש ההטבה' });
    fireEvent.click(confirmYes);

    // Every control that could restart the flow is now disabled, not just
    // blocked by the guard — belt and suspenders.
    expect(confirmYes).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ביטול וחזרה' })).toBeDisabled();
    fireEvent.click(confirmYes);
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול וחזרה' }));

    resolveConsume({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).toBeInTheDocument());
    expect(consumeVoucher).toHaveBeenCalledTimes(1);
  });

  // ── expiry while the dialog is already open ───────────────────────────────

  it('cannot be confirmed or consumed once the voucher expires while the confirmation dialog is already open', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 3000).toISOString();
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ expiresAt }) });

    renderPage();
    fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));
    await vi.waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    const confirmYes = screen.getByRole('button', { name: 'כן, מימוש ההטבה' });
    expect(confirmYes).not.toBeDisabled();

    vi.advanceTimersByTime(4000);
    await vi.waitFor(() => expect(confirmYes).toBeDisabled());

    fireEvent.click(confirmYes);
    expect(consumeVoucher).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // ── example code matches the real format ──────────────────────────────────

  it('shows a code placeholder matching the real voucher alphabet and length', () => {
    // Mirrors server/app/core/security.py's READABLE_ALPHABET / VOUCHER_CODE_LENGTH:
    // no 0/O/1/I/L, exactly 10 characters.
    const VOUCHER_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

    renderPage();

    const input = screen.getByLabelText('קוד שובר') as HTMLInputElement;
    const example = input.placeholder.replace(/[^A-Z0-9]/g, '');
    expect(example).toMatch(VOUCHER_CODE_PATTERN);
  });

  // ── CAR-69: one distinct, actionable failure state per row ─────────────────

  describe('failure states', () => {
    it('rejects a malformed code before calling the API, with a format hint', async () => {
      renderPage();

      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TOOSHORT' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      expect(peekVoucher).not.toHaveBeenCalled();
      expect(screen.getByText(/הזינו קוד בן 10 תווים/)).toBeInTheDocument();
      // Still on the entry form, not stuck in a loading or failure step.
      expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument();
    });

    it('clears the format hint once the cashier edits the code', async () => {
      renderPage();

      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TOOSHORT' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));
      expect(screen.getByText(/הזינו קוד בן 10 תווים/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'T' } });
      expect(screen.queryByText(/הזינו קוד בן 10 תווים/)).not.toBeInTheDocument();
    });

    it('reads an unknown or another business’s voucher (404) as "cannot verify the voucher"', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'not_valid_here' });

      renderPage();
      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByText('לא ניתן לאמת את השובר')).toBeInTheDocument();
    });

    it('shows the expired failure card, with the expiry date, for a voucher peeked back as expired', async () => {
      const expiresAt = '2026-08-14T10:00:00.000Z';
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ status: 'expired', expiresAt }) });

      renderPage();
      await enterCode('TXQ947ZKPS');

      // Same title as the review card's own "expired" status label — a
      // stale voucher found on lookup is not the same story as one that
      // expired in the seconds between lookup and confirm (below), so it
      // gets the plain title and message, not the timing-specific one.
      expect(screen.getByText('השובר פג תוקף')).toBeInTheDocument();
      expect(screen.queryByText(/לפני שהמימוש אושר/)).not.toBeInTheDocument();
      expect(screen.getByText(new Date(expiresAt).toLocaleString('he-IL'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'מימוש ההטבה' })).not.toBeInTheDocument();
      expect(consumeVoucher).not.toHaveBeenCalled();
    });

    it('shows when an already-used voucher was redeemed, on a peek result', async () => {
      const redeemedAt = '2026-08-20T10:00:00.000Z';
      vi.mocked(peekVoucher).mockResolvedValue({
        outcome: 'ok',
        voucher: makeVoucher({ status: 'used', isUsed: true, redeemedAt }),
      });

      renderPage();
      await enterCode('TXQ947ZKPS');

      expect(screen.getByText('מומש בתאריך')).toBeInTheDocument();
      expect(screen.getByText(new Date(redeemedAt).toLocaleString('he-IL'))).toBeInTheDocument();
    });

    it('shows when an already-used voucher was redeemed even when the conflict is only discovered at confirm', async () => {
      const redeemedAt = '2026-08-20T10:00:00.000Z';
      vi.mocked(peekVoucher)
        .mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher() })
        // Someone else redeemed it between the peek and the confirm click; the
        // re-peek this triggers is how the page learns the real timestamp.
        .mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher({ status: 'used', redeemedAt }) });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'already_used' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('השובר כבר מומש')).toBeInTheDocument());
      expect(peekVoucher).toHaveBeenCalledTimes(2);
      expect(screen.getByText(new Date(redeemedAt).toLocaleString('he-IL'))).toBeInTheDocument();
    });

    // ── CAR-69 review: the already_used recovery re-peek must stay guarded ────

    it('blocks every exit path and a second redeem attempt while the already_used recovery re-peek is still pending, and lands on one deterministic state once it settles', async () => {
      vi.mocked(peekVoucher).mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher() });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'already_used' });

      const redeemedAt = '2026-08-20T10:00:00.000Z';
      let resolveRecoveryPeek!: (result: VoucherResult) => void;
      vi.mocked(peekVoucher).mockReturnValueOnce(new Promise((resolve) => (resolveRecoveryPeek = resolve)));

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      // consume has settled as already_used; the recovery re-peek is now the
      // one request still in flight, and every exit path is attempted while
      // it is held open.
      await waitFor(() => expect(consumeVoucher).toHaveBeenCalledTimes(1));

      document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); // Escape
      fireEvent.click(screen.getByRole('button', { name: 'סגירה' })); // dialog's own "x"
      fireEvent.click(screen.getByRole('button', { name: 'ביטול' })); // dialog Cancel
      fireEvent.click(screen.getByRole('button', { name: 'ביטול וחזרה' })); // review card's back-to-entry
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' })); // review card's own Redeem button

      // None of the above reopened code entry or restarted the confirm flow —
      // still mid-recovery, not the stale pending voucher, not back at entry.
      expect(screen.queryByLabelText('קוד שובר')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'כן, מימוש ההטבה' })).toBeDisabled();

      // No second consumeVoucher call happened no matter what was clicked above.
      expect(consumeVoucher).toHaveBeenCalledTimes(1);

      // The recovery re-peek settles — exactly one deterministic outcome,
      // not overwritten by any of the attempted exits above.
      resolveRecoveryPeek({ outcome: 'ok', voucher: makeVoucher({ status: 'used', redeemedAt }) });

      await waitFor(() => expect(screen.getByText('השובר כבר מומש')).toBeInTheDocument());
      expect(screen.getByText(new Date(redeemedAt).toLocaleString('he-IL'))).toBeInTheDocument();
      expect(consumeVoucher).toHaveBeenCalledTimes(1);
      expect(peekVoucher).toHaveBeenCalledTimes(2);

      // The guard released once the flow actually finished: back-to-entry
      // now works normally.
      fireEvent.click(screen.getByRole('button', { name: 'הזנת קוד אחר' }));
      expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument();
    });

    it('reads an expired-between-lookup-and-confirm conflict as a timing problem, not a rejection', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'expired' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('פג תוקף השובר')).toBeInTheDocument());
      expect(screen.getByText(/לפני שהמימוש אושר/)).toBeInTheDocument();
    });

    it('reaches the expired-timing state purely from the server response, not from any fixed TTL value', async () => {
      // Two vouchers with wildly different TTLs both land on the same
      // expired-conflict copy — nothing in the client hardcodes a duration.
      for (const expiresAt of [
        new Date(Date.now() + 5_000).toISOString(),
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ]) {
        vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ expiresAt }) });
        vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'expired' });

        const { unmount } = renderPage();
        await enterCode('TXQ947ZKPS');
        fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
        fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

        await waitFor(() => expect(screen.getByText('פג תוקף השובר')).toBeInTheDocument());
        unmount();
      }
    });

    it('shows the Retry-After value for a rate-limited attempt', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'rate_limited', retryAfterSeconds: 42 });

      renderPage();
      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByText('נסו שוב בעוד (שניות)')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders the cannot-verify state, not success, on a connectivity failure — and says not to hand over the goods', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'network_error' });

      renderPage();
      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByText('שגיאת תקשורת')).toBeInTheDocument();
      expect(screen.getByText(/אל תמסרו את המוצר/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).not.toBeInTheDocument();
    });

    it('renders a not-recorded state (not the lookup-phase copy, and not success) when connectivity drops during confirm', async () => {
      // At this point the voucher was already verified — the uncertainty is
      // whether the redemption itself was recorded, which is a different
      // thing to tell a cashier than "cannot verify the voucher" (the
      // lookup-phase copy, asserted not to appear here).
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'network_error' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('המימוש לא אושר')).toBeInTheDocument());
      expect(screen.getByText(/אל תמסרו את המוצר/)).toBeInTheDocument();
      expect(screen.queryByText('שגיאת תקשורת')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).not.toBeInTheDocument();
    });

    it('renders the confirm-phase not-recorded copy in English too', async () => {
      window.localStorage.setItem('carma_lang', 'EN');
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'network_error' });

      renderPage();
      fireEvent.change(screen.getByLabelText('Voucher code'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'Check code' }));
      await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Redeem reward' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, redeem it' }));

      await waitFor(() => expect(screen.getByText('Redemption not confirmed')).toBeInTheDocument());
      expect(screen.getByText(/Do not hand over the goods/)).toBeInTheDocument();
      expect(screen.queryByText('Connection error')).not.toBeInTheDocument();
    });

    // ── CAR-340 review: unexpected_error at confirm must never claim the
    // voucher was not consumed without proof — vouchers.ts's toResult says an
    // unexpected_error response "may well have reached the server," so the
    // redemption may have actually gone through despite the client-side
    // failure. handleConfirm re-peeks before saying anything, exactly like
    // its already_used recovery. ──────────────────────────────────────────

    it('re-peeks after an unexpected redeem failure and only shows the reassuring "not consumed" message once that re-peek proves it', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'unexpected_error' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('המימוש נכשל')).toBeInTheDocument());
      expect(screen.getByText(/השובר לא נצרך/)).toBeInTheDocument();
      // Not the generic lookup-phase fallback, which says nothing about the
      // voucher being safe to retry.
      expect(screen.queryByText('משהו השתבש')).not.toBeInTheDocument();
      // One peek for the initial lookup, a second as the reconciliation
      // re-peek that actually earned this message.
      expect(peekVoucher).toHaveBeenCalledTimes(2);
    });

    it('shows the already-used failure card, not a "not consumed" claim, when reconciliation reveals the redemption actually went through', async () => {
      const redeemedAt = '2026-08-20T10:00:00.000Z';
      vi.mocked(peekVoucher)
        .mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher() })
        // The unexpected_error response reached the client after the server
        // had already committed the redemption — the reconciliation re-peek
        // is how the page discovers that.
        .mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher({ status: 'used', redeemedAt }) });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'unexpected_error' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('השובר כבר מומש')).toBeInTheDocument());
      expect(screen.getByText(new Date(redeemedAt).toLocaleString('he-IL'))).toBeInTheDocument();
      expect(screen.queryByText('המימוש נכשל')).not.toBeInTheDocument();
      expect(screen.queryByText(/השובר לא נצרך/)).not.toBeInTheDocument();
    });

    it('never claims the voucher was not consumed when an unexpected redeem failure cannot be reconciled either way', async () => {
      vi.mocked(peekVoucher)
        .mockResolvedValueOnce({ outcome: 'ok', voucher: makeVoucher() })
        // The reconciliation re-peek itself fails — nothing is proven either
        // way, so this must stay in the unresolved, safety-first state.
        .mockResolvedValueOnce({ outcome: 'network_error' });
      vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'unexpected_error' });

      renderPage();
      await enterCode('TXQ947ZKPS');
      fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
      fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

      await waitFor(() => expect(screen.getByText('המימוש לא אושר')).toBeInTheDocument());
      expect(screen.getByText(/אל תמסרו את המוצר/)).toBeInTheDocument();
      // Must never claim the voucher definitely was not consumed when the
      // application cannot establish that fact.
      expect(screen.queryByText('המימוש נכשל')).not.toBeInTheDocument();
      expect(screen.queryByText(/השובר לא נצרך/)).not.toBeInTheDocument();
    });

    it('falls back to a safe, translated message for an unexpected failure, without any raw server text or status code', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'unexpected_error' });

      renderPage();
      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
      expect(screen.queryByText(/500/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Internal/)).not.toBeInTheDocument();
    });

    it('offers a way back to code entry from every failure state', async () => {
      vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'not_valid_here' });

      renderPage();
      fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'TXQ947ZKPS' } });
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'הזנת קוד אחר' }));

      expect(screen.getByLabelText('קוד שובר')).toBeInTheDocument();
    });
  });
});
