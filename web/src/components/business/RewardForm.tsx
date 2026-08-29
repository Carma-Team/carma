import { useRef, useState, type FormEvent, type MutableRefObject, type RefObject } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { createReward, updateReward, type Reward, type RewardPayload } from '@/lib/api/rewards';
import { BUSINESS_CATEGORIES, isBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import { categoryTranslationKey, expiryDateInputToIso, isoToExpiryDateInput } from '@/lib/rewardState';
import { Dialog, Input, Button, Text } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

type FormState = {
  titleHe: string;
  titleEn: string;
  descriptionHe: string;
  descriptionEn: string;
  category: BusinessCategory;
  costPoints: string;
  stock: string;
  expiresAt: string;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

// Visual/tab order, used to pick which field gets focus after a failed
// validation. 'category' is excluded — the <select> only ever holds one of
// BUSINESS_CATEGORIES, so validate() never rejects it.
const FIELD_ORDER = ['titleHe', 'titleEn', 'descriptionHe', 'descriptionEn', 'costPoints', 'stock', 'expiresAt'] as const;

function emptyForm(defaultCategory: BusinessCategory): FormState {
  return {
    titleHe: '',
    titleEn: '',
    descriptionHe: '',
    descriptionEn: '',
    category: defaultCategory,
    costPoints: '',
    stock: '',
    expiresAt: '',
  };
}

function formFromReward(reward: Reward, defaultCategory: BusinessCategory): FormState {
  return {
    titleHe: reward.titleHe,
    titleEn: reward.titleEn ?? '',
    descriptionHe: reward.descriptionHe,
    descriptionEn: reward.descriptionEn ?? '',
    // A form field must hold a *selectable* option, so an unrecognized
    // legacy category falls back to the business's own category — unlike
    // the list page's read-only display, which falls back to 'other'
    // (see rewardState.ts's categoryTranslationKey). Different fallback
    // targets for genuinely different jobs, both built on the same
    // `isBusinessCategory` check.
    category: isBusinessCategory(reward.category) ? reward.category : defaultCategory,
    costPoints: String(reward.costPoints),
    stock: reward.stock === null ? '' : String(reward.stock),
    expiresAt: reward.expiresAt ? isoToExpiryDateInput(reward.expiresAt) : '',
  };
}

// Digits only, so "3.5" and "3abc" are both rejected rather than silently
// truncated by Number() — the same integer constraint the server enforces
// with `ge=1`/`ge=0` (BusinessRewardIn/PatchIn), checked here first so a
// malformed value never reaches the network.
const INTEGER_PATTERN = /^\d+$/;

function validate(form: FormState, t: (key: string) => string): FieldErrors {
  const errors: FieldErrors = {};

  if (form.titleHe.trim() === '') errors.titleHe = t('rewards.validationRequired');
  else if (form.titleHe.trim().length > TITLE_MAX) errors.titleHe = t('rewards.validationTitleTooLong');

  if (form.titleEn.trim() === '') errors.titleEn = t('rewards.validationRequired');
  else if (form.titleEn.trim().length > TITLE_MAX) errors.titleEn = t('rewards.validationTitleTooLong');

  if (form.descriptionHe.trim() === '') errors.descriptionHe = t('rewards.validationRequired');
  else if (form.descriptionHe.trim().length > DESCRIPTION_MAX) errors.descriptionHe = t('rewards.validationDescriptionTooLong');

  if (form.descriptionEn.trim() === '') errors.descriptionEn = t('rewards.validationRequired');
  else if (form.descriptionEn.trim().length > DESCRIPTION_MAX) errors.descriptionEn = t('rewards.validationDescriptionTooLong');

  const cost = form.costPoints.trim();
  if (!INTEGER_PATTERN.test(cost) || Number(cost) < 1) errors.costPoints = t('rewards.validationCostInvalid');

  const stock = form.stock.trim();
  if (stock !== '' && !INTEGER_PATTERN.test(stock)) errors.stock = t('rewards.validationAllocationInvalid');

  // expiresAt is deliberately absent here — a blank value is valid and means
  // "no expiry" (server: `expires_at: datetime | None = None`).

  return errors;
}

function toPayload(form: FormState): RewardPayload {
  const stock = form.stock.trim();
  return {
    titleHe: form.titleHe.trim(),
    titleEn: form.titleEn.trim(),
    descriptionHe: form.descriptionHe.trim(),
    descriptionEn: form.descriptionEn.trim(),
    category: form.category,
    costPoints: Number(form.costPoints.trim()),
    stock: stock === '' ? null : Number(stock),
    expiresAt: form.expiresAt === '' ? null : expiryDateInputToIso(form.expiresAt),
  };
}

type RewardFormProps = {
  open: boolean;
  mode: 'create' | 'edit';
  // The reward being edited. Ignored in 'create' mode.
  reward: Reward | null;
  defaultCategory: BusinessCategory;
  onClose: () => void;
  onSaved: (reward: Reward) => void;
};

export function RewardForm({ open, mode, reward, defaultCategory, onClose, onSaved }: RewardFormProps) {
  const { t } = useTranslation();
  // Mutated (not state) by RewardFormBody, read by this Dialog's onClose —
  // a ref crosses that boundary without either side re-rendering on every
  // keystroke. Guards Escape/backdrop-cancel while a save is in flight, the
  // same convention as RedemptionPage's redeemInFlight.
  const submitInFlight = useRef(false);

  // Remounts RewardFormBody (never this Dialog) whenever the create/edit
  // target actually changes, including a close-then-reopen — so a fresh
  // instance always starts from the right initial values without an effect
  // reaching back to reset state after the fact (see rewardState usage
  // below and CAR-202's pre-commit review, B1). The Dialog element itself
  // stays mounted across that remount, so its `open` prop toggles the same
  // native <dialog> node throughout — which is what lets the browser's own
  // focus-restore-on-close behaviour do its job on every close path.
  const bodyKey = !open ? 'closed' : mode === 'edit' && reward ? `edit-${reward.id}` : 'create';

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (submitInFlight.current) return;
        onClose();
      }}
      title={t(mode === 'edit' ? 'rewards.formEditTitle' : 'rewards.formCreateTitle')}
      closeLabel={t('rewards.formCloseLabel')}
    >
      <RewardFormBody
        key={bodyKey}
        mode={mode}
        reward={reward}
        defaultCategory={defaultCategory}
        submitInFlightRef={submitInFlight}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  );
}

function RewardFormBody({
  mode,
  reward,
  defaultCategory,
  submitInFlightRef,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  reward: Reward | null;
  defaultCategory: BusinessCategory;
  submitInFlightRef: MutableRefObject<boolean>;
  onClose: () => void;
  onSaved: (reward: Reward) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() =>
    mode === 'edit' && reward ? formFromReward(reward, defaultCategory) : emptyForm(defaultCategory),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const titleHeRef = useRef<HTMLInputElement>(null);
  const titleEnRef = useRef<HTMLInputElement>(null);
  const descriptionHeRef = useRef<HTMLTextAreaElement>(null);
  const descriptionEnRef = useRef<HTMLTextAreaElement>(null);
  const costPointsRef = useRef<HTMLInputElement>(null);
  const stockRef = useRef<HTMLInputElement>(null);
  const expiresAtRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<(typeof FIELD_ORDER)[number], RefObject<HTMLInputElement | HTMLTextAreaElement>> = {
    titleHe: titleHeRef,
    titleEn: titleEnRef,
    descriptionHe: descriptionHeRef,
    descriptionEn: descriptionEnRef,
    costPoints: costPointsRef,
    stock: stockRef,
    expiresAt: expiresAtRef,
  };

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitInFlightRef.current) return;

    const fieldErrors = validate(form, t);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      // Move focus to the first invalid field, in visual order, instead of
      // leaving it on the Save button with no indication anything failed —
      // `noValidate` on the <form> below opts out of the browser's own
      // "focus the first invalid field" behaviour (needed so validate()
      // runs instead of native constraint validation), so this replaces it.
      const firstInvalidField = FIELD_ORDER.find((key) => fieldErrors[key]);
      if (firstInvalidField) fieldRefs[firstInvalidField].current?.focus();
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const payload = toPayload(form);
    const result =
      mode === 'edit' && reward ? await updateReward(reward.id, payload) : await createReward(payload);
    submitInFlightRef.current = false;
    setSubmitting(false);

    if (result.outcome === 'ok') {
      onSaved(result.reward);
      return;
    }
    // Form data is deliberately left as-is (state is untouched) so a failed
    // submit never costs the business what it already typed.
    setSubmitError(t('rewards.saveErrorMessage'));
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Input
        ref={titleHeRef}
        label={t('rewards.titleHeLabel')}
        dir="rtl"
        maxLength={TITLE_MAX}
        required
        error={errors.titleHe}
        value={form.titleHe}
        onChange={(event) => updateField('titleHe', event.target.value)}
      />
      <Input
        ref={titleEnRef}
        label={t('rewards.titleEnLabel')}
        dir="ltr"
        maxLength={TITLE_MAX}
        required
        error={errors.titleEn}
        value={form.titleEn}
        onChange={(event) => updateField('titleEn', event.target.value)}
      />
      <div className={inputStyles.field}>
        <label htmlFor="reward-description-he" className={inputStyles.label}>
          {t('rewards.descriptionHeLabel')}
        </label>
        <textarea
          ref={descriptionHeRef}
          id="reward-description-he"
          dir="rtl"
          maxLength={DESCRIPTION_MAX}
          required
          className={[inputStyles.input, errors.descriptionHe && inputStyles.inputError].filter(Boolean).join(' ')}
          aria-invalid={Boolean(errors.descriptionHe)}
          aria-describedby={errors.descriptionHe ? 'reward-description-he-error' : undefined}
          value={form.descriptionHe}
          onChange={(event) => updateField('descriptionHe', event.target.value)}
        />
        {errors.descriptionHe && (
          <span id="reward-description-he-error" className={inputStyles.error}>
            {errors.descriptionHe}
          </span>
        )}
      </div>
      <div className={inputStyles.field}>
        <label htmlFor="reward-description-en" className={inputStyles.label}>
          {t('rewards.descriptionEnLabel')}
        </label>
        <textarea
          ref={descriptionEnRef}
          id="reward-description-en"
          dir="ltr"
          maxLength={DESCRIPTION_MAX}
          required
          className={[inputStyles.input, errors.descriptionEn && inputStyles.inputError].filter(Boolean).join(' ')}
          aria-invalid={Boolean(errors.descriptionEn)}
          aria-describedby={errors.descriptionEn ? 'reward-description-en-error' : undefined}
          value={form.descriptionEn}
          onChange={(event) => updateField('descriptionEn', event.target.value)}
        />
        {errors.descriptionEn && (
          <span id="reward-description-en-error" className={inputStyles.error}>
            {errors.descriptionEn}
          </span>
        )}
      </div>
      <div className={inputStyles.field}>
        <label htmlFor="reward-category" className={inputStyles.label}>
          {t('rewards.categoryLabel')}
        </label>
        <select
          id="reward-category"
          className={inputStyles.input}
          required
          value={form.category}
          onChange={(event) => updateField('category', event.target.value as BusinessCategory)}
        >
          {BUSINESS_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`rewards.${categoryTranslationKey(category)}`)}
            </option>
          ))}
        </select>
      </div>
      <Input
        ref={costPointsRef}
        label={t('rewards.costPointsInputLabel')}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        required
        error={errors.costPoints}
        value={form.costPoints}
        onChange={(event) => updateField('costPoints', event.target.value)}
      />
      <Input
        ref={stockRef}
        label={t('rewards.allocationInputLabel')}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        placeholder={t('rewards.allocationHint')}
        error={errors.stock}
        value={form.stock}
        onChange={(event) => updateField('stock', event.target.value)}
      />
      <div className={inputStyles.field}>
        <Input
          ref={expiresAtRef}
          label={t('rewards.expiresInputLabel')}
          type="date"
          error={errors.expiresAt}
          value={form.expiresAt}
          onChange={(event) => updateField('expiresAt', event.target.value)}
        />
        <Text variant="caption">{t('rewards.expiresHint')}</Text>
      </div>

      {submitError && (
        <Text variant="caption" role="alert">
          {submitError}
        </Text>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('rewards.savingLabel') : t('rewards.saveButton')}
        </Button>
        <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
          {t('rewards.cancelButton')}
        </Button>
      </div>
    </form>
  );
}
