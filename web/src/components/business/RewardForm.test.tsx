import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { RewardForm } from './RewardForm';
import { createReward, updateReward } from '@/lib/api/rewards';
import type { Reward } from '@/lib/api/rewards';
import { isoToExpiryDateInput } from '@/lib/rewardState';

vi.mock('@/lib/api/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rewards')>();
  return { ...actual, createReward: vi.fn(), updateReward: vi.fn() };
});

const REWARD: Reward = {
  id: 'r1',
  businessId: 'b1',
  business: 'Biz',
  businessHe: null,
  titleHe: 'שובר קיים',
  titleEn: 'Existing voucher',
  descriptionHe: 'תיאור קיים',
  descriptionEn: 'Existing description',
  category: 'food',
  costPoints: 50,
  imageIcon: 'gift-outline',
  isActive: true,
  archivedAt: null,
  stock: 5,
  available: 3,
  expiresAt: '2030-06-15T20:59:59.999Z',
};

function renderForm(props: Partial<React.ComponentProps<typeof RewardForm>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <LanguageProvider>
      <RewardForm
        open
        mode="create"
        reward={null}
        defaultCategory="food"
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </LanguageProvider>,
  );
  return { ...utils, onClose, onSaved };
}

// Renders a trigger button plus RewardForm, wired the way RewardsPage wires
// them — used by the focus-restore tests below, which need a real element
// to have had focus before the dialog opened (matching what a real click on
// "New reward"/"Edit" would leave focused).
function Harness({ mode = 'create', reward = null }: { mode?: 'create' | 'edit'; reward?: Reward | null }) {
  const [open, setOpen] = useState(false);
  return (
    <LanguageProvider>
      <button type="button" onClick={() => setOpen(true)}>
        open trigger
      </button>
      <RewardForm
        open={open}
        mode={mode}
        reward={reward}
        defaultCategory="food"
        onClose={() => setOpen(false)}
        onSaved={() => setOpen(false)}
      />
    </LanguageProvider>
  );
}

function fillValidCreateForm() {
  fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'שובר חדש' } });
  fireEvent.change(screen.getByLabelText('כותרת (אנגלית)'), { target: { value: 'New reward' } });
  fireEvent.change(screen.getByLabelText('תיאור (עברית)'), { target: { value: 'תיאור' } });
  fireEvent.change(screen.getByLabelText('תיאור (אנגלית)'), { target: { value: 'Description' } });
  fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('תאריך תפוגה'), { target: { value: '2030-01-01' } });
}

describe('RewardForm', () => {
  // Mirrors the two things a real <dialog> does that matter here (HTML
  // Living Standard): showModal() remembers whatever was focused at the
  // time, close() restores focus to it. jsdom implements neither, so the
  // focus-restore tests below are only meaningful because this mock does.
  let previouslyFocused: Element | null = null;

  beforeEach(() => {
    previouslyFocused = null;
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      previouslyFocused = document.activeElement;
      this.setAttribute('open', '');
    }) as unknown as () => void;
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    }) as unknown as () => void;
    vi.mocked(createReward).mockReset();
    vi.mocked(updateReward).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── focus restore on close (CAR-202 pre-commit review, B1) ────────────────

  it('returns focus to the button that opened the dialog after Cancel', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'open trigger' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByRole('button', { name: 'ביטול' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the button that opened the dialog after the × close button', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'open trigger' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByRole('button', { name: 'סגירה' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'סגירה' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the button that opened the dialog after a successful save', async () => {
    vi.mocked(createReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'open trigger' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByLabelText('כותרת (עברית)')).toBeInTheDocument());
    fillValidCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('resets to a clean form when reopened for a different reward, without leaking the previous target', async () => {
    const rewardA: Reward = { ...REWARD, id: 'a', titleHe: 'הטבה א' };
    const rewardB: Reward = { ...REWARD, id: 'b', titleHe: 'הטבה ב', costPoints: 200 };
    const { rerender } = render(
      <LanguageProvider>
        <RewardForm open mode="edit" reward={rewardA} defaultCategory="food" onClose={vi.fn()} onSaved={vi.fn()} />
      </LanguageProvider>,
    );
    expect(screen.getByLabelText('כותרת (עברית)')).toHaveValue('הטבה א');

    // Close, then open again for a different reward — the review's B1 fix
    // must not reintroduce stale state across this transition.
    rerender(
      <LanguageProvider>
        <RewardForm open={false} mode="edit" reward={rewardA} defaultCategory="food" onClose={vi.fn()} onSaved={vi.fn()} />
      </LanguageProvider>,
    );
    rerender(
      <LanguageProvider>
        <RewardForm open mode="edit" reward={rewardB} defaultCategory="food" onClose={vi.fn()} onSaved={vi.fn()} />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText('כותרת (עברית)')).toHaveValue('הטבה ב');
    expect(screen.getByLabelText('עלות בנקודות')).toHaveValue(200);
  });

  // ── focus on validation failure (B2) ───────────────────────────────────────

  it('focuses the first invalid field when only the English title is missing', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'שובר' } });
    fireEvent.change(screen.getByLabelText('תיאור (עברית)'), { target: { value: 'תיאור' } });
    fireEvent.change(screen.getByLabelText('תיאור (אנגלית)'), { target: { value: 'Description' } });
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(document.activeElement).toBe(screen.getByLabelText('כותרת (אנגלית)'));
    expect(screen.getByLabelText('כותרת (אנגלית)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('כותרת (אנגלית)')).toHaveAttribute('aria-describedby');
  });

  it('focuses the first invalid field in visual order when several fields fail validation', () => {
    renderForm();
    // Everything left blank except an invalid cost — titleHe precedes
    // costPoints in the field order, so it (not costPoints) gets focus.
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(document.activeElement).toBe(screen.getByLabelText('כותרת (עברית)'));
  });

  it('describes an invalid textarea to assistive technology via aria-describedby', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'שובר' } });
    fireEvent.change(screen.getByLabelText('כותרת (אנגלית)'), { target: { value: 'Reward' } });
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '20' } });
    // Both descriptions left blank.

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    const descriptionHe = screen.getByLabelText('תיאור (עברית)');
    expect(document.activeElement).toBe(descriptionHe);
    expect(descriptionHe).toHaveAttribute('aria-invalid', 'true');
    const describedBy = descriptionHe.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('שדה חובה.');
  });

  // ── create / edit payloads ──────────────────────────────────────────────

  it('calls createReward exactly once with the expected payload, sending a blank allocation as null', async () => {
    vi.mocked(createReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm();

    fillValidCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createReward).toHaveBeenCalledTimes(1));
    expect(createReward).toHaveBeenCalledWith({
      titleHe: 'שובר חדש',
      titleEn: 'New reward',
      descriptionHe: 'תיאור',
      descriptionEn: 'Description',
      category: 'food',
      costPoints: 20,
      stock: null,
      expiresAt: expect.any(String),
    });
  });

  it('submits a numeric allocation as that integer', async () => {
    vi.mocked(createReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm();

    fillValidCreateForm();
    fireEvent.change(screen.getByLabelText('מלאי'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createReward).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReward).mock.calls[0][0].stock).toBe(25);
  });

  it('rejects submission when the English title is left blank — neither language may be silently missing', async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'שובר' } });
    fireEvent.change(screen.getByLabelText('תיאור (עברית)'), { target: { value: 'תיאור' } });
    fireEvent.change(screen.getByLabelText('תיאור (אנגלית)'), { target: { value: 'Description' } });
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('תאריך תפוגה'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(createReward).not.toHaveBeenCalled();
    expect(screen.getByText('שדה חובה.')).toBeInTheDocument();
  });

  it('rejects a cost of zero, which the server also refuses (ge=1)', async () => {
    renderForm();

    fillValidCreateForm();
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(createReward).not.toHaveBeenCalled();
    expect(screen.getByText('הזינו מספר שלם של לפחות 1.')).toBeInTheDocument();
  });

  it('rejects a negative allocation, which the server also refuses (ge=0)', async () => {
    renderForm();

    fillValidCreateForm();
    fireEvent.change(screen.getByLabelText('מלאי'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    expect(createReward).not.toHaveBeenCalled();
    expect(screen.getByText('הזינו מספר שלם 0 ומעלה, או השאירו ריק ללא הגבלה.')).toBeInTheDocument();
  });

  it('prevents a duplicate submission while a save is already in flight', async () => {
    let resolveCall: (value: { outcome: 'ok'; reward: Reward }) => void = () => {};
    vi.mocked(createReward).mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderForm();

    fillValidCreateForm();
    const saveButton = screen.getByRole('button', { name: 'שמירה' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    resolveCall({ outcome: 'ok', reward: REWARD });
    await waitFor(() => expect(createReward).toHaveBeenCalledTimes(1));
  });

  it('keeps the entered data and shows an error when the save request fails', async () => {
    vi.mocked(createReward).mockResolvedValue({ outcome: 'network_error' });
    renderForm();

    fillValidCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('כותרת (עברית)')).toHaveValue('שובר חדש');
  });

  it('prefills the form from the existing reward in edit mode and preserves untouched fields on save', async () => {
    vi.mocked(updateReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm({ mode: 'edit', reward: REWARD });

    expect(screen.getByLabelText('כותרת (עברית)')).toHaveValue('שובר קיים');
    expect(screen.getByLabelText('מלאי')).toHaveValue(5);

    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateReward).toHaveBeenCalledTimes(1));
    const [id, payload] = vi.mocked(updateReward).mock.calls[0];
    expect(id).toBe('r1');
    expect(payload.titleHe).toBe('שובר קיים');
    expect(payload.stock).toBe(5);
  });

  it('sends an explicit null when an existing allocation is cleared during editing', async () => {
    vi.mocked(updateReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm({ mode: 'edit', reward: REWARD });

    fireEvent.change(screen.getByLabelText('מלאי'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateReward).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(updateReward).mock.calls[0][1];
    expect('stock' in payload).toBe(true);
    expect(payload.stock).toBeNull();
  });

  // ── expiry is optional (N7) ─────────────────────────────────────────────

  it('creates a reward with no expiry date, submitting expiresAt: null', async () => {
    vi.mocked(createReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm();

    fireEvent.change(screen.getByLabelText('כותרת (עברית)'), { target: { value: 'שובר' } });
    fireEvent.change(screen.getByLabelText('כותרת (אנגלית)'), { target: { value: 'Reward' } });
    fireEvent.change(screen.getByLabelText('תיאור (עברית)'), { target: { value: 'תיאור' } });
    fireEvent.change(screen.getByLabelText('תיאור (אנגלית)'), { target: { value: 'Description' } });
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '20' } });
    // Expiry left blank on purpose.
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(createReward).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReward).mock.calls[0][0].expiresAt).toBeNull();
  });

  it('edits a legacy reward that has no expiry without forcing one to be set', async () => {
    const noExpiryReward: Reward = { ...REWARD, expiresAt: null };
    vi.mocked(updateReward).mockResolvedValue({ outcome: 'ok', reward: noExpiryReward });
    renderForm({ mode: 'edit', reward: noExpiryReward });

    expect(screen.getByLabelText('תאריך תפוגה')).toHaveValue('');

    // Touch only an unrelated field.
    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateReward).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(updateReward).mock.calls[0][1];
    expect(payload.costPoints).toBe(99);
    expect(payload.expiresAt).toBeNull();
  });

  it('sends an explicit null when an existing expiry is cleared during editing', async () => {
    vi.mocked(updateReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm({ mode: 'edit', reward: REWARD });

    fireEvent.change(screen.getByLabelText('תאריך תפוגה'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateReward).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(updateReward).mock.calls[0][1];
    expect('expiresAt' in payload).toBe(true);
    expect(payload.expiresAt).toBeNull();
  });

  it('preserves an existing expiry when editing an unrelated field', async () => {
    vi.mocked(updateReward).mockResolvedValue({ outcome: 'ok', reward: REWARD });
    renderForm({ mode: 'edit', reward: REWARD });

    fireEvent.change(screen.getByLabelText('עלות בנקודות'), { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() => expect(updateReward).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(updateReward).mock.calls[0][1];
    expect(payload.expiresAt).not.toBeNull();
    // Same calendar date the form was prefilled with — not a byte-identical
    // ISO string, which would make this test depend on the runner's
    // timezone rather than on the round-trip actually being correct.
    expect(isoToExpiryDateInput(payload.expiresAt as string)).toBe(isoToExpiryDateInput(REWARD.expiresAt as string));
  });
});
