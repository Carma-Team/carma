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
  stock: null,
  available: null,
  expiresAt: null,
};

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    rewardId: 'r1',
    code: 'CRM8421',
    qrData: 'CRM8421',
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
  await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
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
    await enterCode('CRM8421');

    expect(screen.getByRole('heading', { name: 'קפה גדול חינם' })).toBeInTheDocument();
    expect(consumeVoucher).not.toHaveBeenCalled();
  });

  it('sends exactly one consume request when confirmation is clicked', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });

    renderPage();
    await enterCode('CRM8421');

    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).toBeInTheDocument());
    expect(consumeVoucher).toHaveBeenCalledTimes(1);
    expect(consumeVoucher).toHaveBeenCalledWith('CRM8421');
  });

  it('does not send a second consume request on a double click', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    let resolveConsume!: (result: VoucherResult) => void;
    vi.mocked(consumeVoucher).mockReturnValue(new Promise((resolve) => (resolveConsume = resolve)));

    renderPage();
    await enterCode('CRM8421');

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
    await enterCode('  crm-8421 ');

    expect(peekVoucher).toHaveBeenCalledWith('  crm-8421 ');
    expect(screen.getByRole('heading', { name: 'קפה גדול חינם' })).toBeInTheDocument();
  });

  it('shows a visible, accurate TTL countdown that ticks down on the review step', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ expiresAt }) });

    renderPage();
    fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'CRM8421' } });
    fireEvent.click(screen.getByRole('button', { name: 'בדיקת קוד' }));
    // flush the mocked async peekVoucher without real timers
    await vi.waitFor(() => expect(screen.getByText('5:00')).toBeInTheDocument());

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(screen.getByText('4:00')).toBeInTheDocument());

    vi.useRealTimers();
  });

  it('does not offer redemption for a voucher peeked back as already used', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher({ status: 'used' }) });

    renderPage();
    await enterCode('CRM8421');

    expect(screen.getByRole('button', { name: 'מימוש ההטבה' })).toBeDisabled();
    expect(consumeVoucher).not.toHaveBeenCalled();
  });

  it('shows a generic, unmistakable failure state without redeeming when consume fails', async () => {
    vi.mocked(peekVoucher).mockResolvedValue({ outcome: 'ok', voucher: makeVoucher() });
    vi.mocked(consumeVoucher).mockResolvedValue({ outcome: 'already_used' });

    renderPage();
    await enterCode('CRM8421');
    fireEvent.click(screen.getByRole('button', { name: 'מימוש ההטבה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, מימוש ההטבה' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'ההטבה מומשה בהצלחה' })).not.toBeInTheDocument();
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
    await enterCode('CRM8421');
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
    await enterCode('CRM8421');
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
    fireEvent.change(screen.getByLabelText('קוד שובר'), { target: { value: 'CRM8421' } });
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
});
