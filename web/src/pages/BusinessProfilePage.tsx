import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasBusinessRole } from '@/lib/auth/businessRole';
import {
  getBusinessProfile,
  updateBusinessProfile,
  type BusinessProfile,
  type BusinessProfileUpdatePayload,
} from '@/lib/api/businessProfile';
import {
  listBranches,
  createBranch,
  updateBranch,
  type Branch,
  type BranchCreatePayload,
  type BranchResult,
  type BranchUpdatePayload,
} from '@/lib/api/businessBranches';
import { geocodeAddress } from '@/lib/api/geocoding';
import { BUSINESS_CATEGORIES, normalizeBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import { LocationConfirmMap } from '@/components/business/LocationConfirmMap';
import {
  Card,
  Heading,
  Text,
  Button,
  Input,
  Select,
  Switch,
  StatusBadge,
  Dialog,
  PageHeader,
  ErrorState,
  LoadingState,
  Skeleton,
} from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './BusinessProfilePage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';
type Tab = 'details' | 'branches';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type FormState = {
  name: string;
  nameHe: string;
  category: BusinessCategory;
};

type FieldErrors = Partial<Record<'name', string>>;

function formFromProfile(profile: BusinessProfile): FormState {
  return {
    name: profile.name,
    nameHe: profile.nameHe ?? '',
    category: normalizeBusinessCategory(profile.category),
  };
}

function validate(form: FormState, t: (key: string) => string): FieldErrors {
  const errors: FieldErrors = {};
  if (form.name.trim().length < 2) errors.name = t('businessProfile.validationRequired');
  return errors;
}

function categoryLabelKey(category: BusinessCategory): keyof TranslationMap['businessProfile'] {
  return `category${category.charAt(0).toUpperCase()}${category.slice(1)}` as keyof TranslationMap['businessProfile'];
}

// The business's own display name in the active UI language — same
// nameHe-first-in-Hebrew fallback AppShell already applies to the session's
// denormalized businessName/businessNameHe, just read off the freshly loaded
// profile record instead so it reflects an edit that hasn't round-tripped
// through the session yet.
function displayName(profile: BusinessProfile, lang: 'HE' | 'EN'): string {
  return (lang === 'HE' ? (profile.nameHe ?? profile.name) : (profile.name ?? profile.nameHe)) ?? profile.name;
}

const SAVED_BANNER_MS = 3000;

type BranchModalMode = { kind: 'create' } | { kind: 'edit'; branch: Branch };

export function BusinessProfilePage() {
  const { t, lang } = useTranslation();
  const { user } = useAuth();
  // Same role split Rewards already draws (CAR-116/CAR-202): OWNER/MANAGER
  // edit, CASHIER gets the read-only view — matching update_profile's and
  // update_branch's CurrentBusinessManager gate server-side.
  const canManage = hasBusinessRole(user?.businessMembershipRole, ['OWNER', 'MANAGER']);

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  // Set only while a tab switch is blocked on an unsaved edit — the confirm
  // dialog's own target, not a second copy of `tab`.
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedBannerTimeout = useRef<number | undefined>(undefined);

  const [branchModal, setBranchModal] = useState<BranchModalMode | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    load();
    return () => {
      cancelled = true;
    };

    function load() {
      Promise.all([getBusinessProfile(), listBranches()]).then(([profileResult, branchesResult]) => {
        if (cancelled) return;
        if (profileResult.outcome === 'ok' && branchesResult.outcome === 'ok') {
          setProfile(profileResult.profile);
          setForm(formFromProfile(profileResult.profile));
          setBranches(branchesResult.branches);
          setStatus('ready');
        } else if (profileResult.outcome === 'forbidden' || branchesResult.outcome === 'forbidden') {
          setStatus('forbidden');
        } else {
          setStatus('error');
        }
      });
    }
  }, []);

  useEffect(() => () => window.clearTimeout(savedBannerTimeout.current), []);

  const dirty = profile !== null && form !== null && JSON.stringify(form) !== JSON.stringify(formFromProfile(profile));

  // A save the user has already typed over must not vanish to a background
  // tab close/refresh — `returnValue` is what actually triggers the browser's
  // own confirmation; the string rarely renders (Chrome/Firefox show their
  // own generic text) but has to be set for the prompt to fire at all.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = t('businessProfile.beforeUnloadWarning');
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, t]);

  function retry() {
    setStatus('loading');
    Promise.all([getBusinessProfile(), listBranches()]).then(([profileResult, branchesResult]) => {
      if (profileResult.outcome === 'ok' && branchesResult.outcome === 'ok') {
        setProfile(profileResult.profile);
        setForm(formFromProfile(profileResult.profile));
        setBranches(branchesResult.branches);
        setStatus('ready');
      } else if (profileResult.outcome === 'forbidden' || branchesResult.outcome === 'forbidden') {
        setStatus('forbidden');
      } else {
        setStatus('error');
      }
    });
  }

  // Switching tabs is the one in-app "leave" this page can actually detect —
  // there's no router-level navigation guard here (see the PR notes), so an
  // edit left dirty while navigating away via the sidebar isn't caught. The
  // beforeunload guard above still covers a full page close/refresh.
  function requestTabChange(next: Tab) {
    if (next === tab) return;
    if (tab === 'details' && dirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  }

  function discardAndSwitchTab() {
    if (!profile || !pendingTab) return;
    setForm(formFromProfile(profile));
    setErrors({});
    setSaveState('idle');
    setTab(pendingTab);
    setPendingTab(null);
  }

  function handleCancelEdits() {
    if (!profile) return;
    setForm(formFromProfile(profile));
    setErrors({});
    setSaveState('idle');
  }

  async function doSave() {
    if (!form) return;
    setSaveState('saving');
    const payload: BusinessProfileUpdatePayload = {
      name: form.name.trim(),
      nameHe: form.nameHe.trim() === '' ? null : form.nameHe.trim(),
      category: form.category,
    };
    const result = await updateBusinessProfile(payload);

    if (result.outcome === 'ok') {
      setProfile(result.profile);
      setForm(formFromProfile(result.profile));
      setSaveState('saved');
      window.clearTimeout(savedBannerTimeout.current);
      savedBannerTimeout.current = window.setTimeout(() => setSaveState('idle'), SAVED_BANNER_MS);
      return;
    }
    setSaveState('error');
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!form || !profile || saveState === 'saving') return;

    const fieldErrors = validate(form, t);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      if (fieldErrors.name) nameRef.current?.focus();
      return;
    }
    setErrors({});
    await doSave();
  }

  function handleBranchSaved(branch: Branch) {
    setBranches((prev) => {
      if (!prev) return prev;
      const exists = prev.some((b) => b.id === branch.id);
      return exists ? prev.map((b) => (b.id === branch.id ? branch : b)) : [...prev, branch];
    });
    setBranchModal(null);
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label={t('businessProfile.loadingLabel')}>
        <Card className={styles.loadingCard}>
          <Skeleton height={68} />
          <Skeleton width="40%" height={14} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="55%" height={14} />
        </Card>
      </div>
    );
  }

  if (status === 'forbidden') {
    return <ErrorState title={t('businessProfile.forbiddenTitle')} message={t('businessProfile.forbiddenMessage')} />;
  }

  if (status === 'error' || !profile || !form || !branches) {
    return (
      <ErrorState
        title={t('businessProfile.loadErrorTitle')}
        message={t('businessProfile.loadErrorMessage')}
        onRetry={retry}
        retryLabel={t('businessProfile.retryButton')}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('businessProfile.title')}
        subtitle={t(canManage ? 'businessProfile.subtitleManage' : 'businessProfile.subtitleReadOnly')}
      />

      {/* Real ARIA tabs, not RewardsPage's plain aria-current filter buttons —
          these switch the whole panel rather than filtering one grid, so the
          roving tabIndex/arrow-key pair below is the one bit that pattern
          actually requires. Only two tabs, so either arrow key just toggles. */}
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t('businessProfile.title')}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          requestTabChange(tab === 'details' ? 'branches' : 'details');
        }}
      >
        <button
          type="button"
          role="tab"
          id="business-profile-tab-details"
          tabIndex={tab === 'details' ? 0 : -1}
          aria-selected={tab === 'details'}
          aria-controls="business-profile-panel-details"
          className={styles.tab}
          onClick={() => requestTabChange('details')}
        >
          <BuildingIcon /> {t('businessProfile.tabDetails')}
        </button>
        <button
          type="button"
          role="tab"
          id="business-profile-tab-branches"
          tabIndex={tab === 'branches' ? 0 : -1}
          aria-selected={tab === 'branches'}
          aria-controls="business-profile-panel-branches"
          className={styles.tab}
          onClick={() => requestTabChange('branches')}
        >
          <MapPinIcon /> {t('businessProfile.tabBranches')}
        </button>
      </div>

      {tab === 'details' ? (
        <div id="business-profile-panel-details" role="tabpanel" aria-labelledby="business-profile-tab-details">
          <form onSubmit={handleSave} noValidate>
            <div className={styles.layout}>
              <div className={styles.main}>
                <LogoCard profile={profile} lang={lang} t={t} />

                <Card className={styles.card}>
                  <Heading level={3}>{t('businessProfile.infoTitle')}</Heading>
                  {canManage ? (
                    <div className={styles.fields}>
                      <Input
                        ref={nameRef}
                        label={t('businessProfile.nameLabel')}
                        required
                        maxLength={120}
                        value={form.name}
                        error={errors.name}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                      />
                      <Input
                        label={t('businessProfile.nameHeLabel')}
                        dir="rtl"
                        maxLength={120}
                        helperText={t('businessProfile.nameHeHint')}
                        value={form.nameHe}
                        onChange={(event) => setForm({ ...form, nameHe: event.target.value })}
                      />
                      <div className={styles.lockedRow}>
                        <Text variant="label" as="span" className={styles.lockedLabel}>
                          <LockIcon /> {t('businessProfile.registrationNumberLabel')}
                        </Text>
                        <span className={styles.lockedValue}>
                          <span dir="ltr">{profile.registrationNumber ?? '—'}</span>
                          <Text variant="caption" as="span">
                            {t('businessProfile.registrationNumberLockedCaption')}
                          </Text>
                        </span>
                      </div>
                      <Text variant="caption">{t('businessProfile.registrationNumberHint')}</Text>
                      <Select
                        label={t('businessProfile.categoryLabel')}
                        required
                        value={form.category}
                        onChange={(event) => setForm({ ...form, category: event.target.value as BusinessCategory })}
                      >
                        {BUSINESS_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {t(`businessProfile.${categoryLabelKey(category)}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <ReadOnlyDetails profile={profile} t={t} />
                  )}
                </Card>
              </div>

              <div className={styles.aside}>
                <ContactCard profile={profile} t={t} />
                {canManage && saveState === 'idle' && !dirty && (
                  <div className={styles.savedNote}>
                    <CheckCircleIcon /> <Text variant="caption">{t('businessProfile.allSavedNote')}</Text>
                  </div>
                )}
              </div>
            </div>

            {canManage && (dirty || saveState !== 'idle') && (
              <div className={styles.saveBar} data-state={saveState}>
                {saveState === 'saving' ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    <Text variant="label" as="span">
                      {t('businessProfile.savingLabel')}
                    </Text>
                  </>
                ) : saveState === 'saved' ? (
                  <>
                    <CheckCircleIcon />
                    <Text variant="label" as="span">
                      {t('businessProfile.savedLabel')}
                    </Text>
                  </>
                ) : saveState === 'error' ? (
                  <>
                    <AlertTriangleIcon />
                    <Text variant="label" as="span" role="alert">
                      {t('businessProfile.saveErrorMessage')}
                    </Text>
                    <div className={styles.saveBarSpacer} />
                    <Button type="submit" variant="secondary" size="sm">
                      {t('businessProfile.saveRetryButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={styles.unsavedDot} aria-hidden="true" />
                    <Text variant="label" as="span">
                      {t('businessProfile.unsavedChangesLabel')}
                    </Text>
                    <div className={styles.saveBarSpacer} />
                    <Button type="button" variant="secondary" onClick={handleCancelEdits}>
                      {t('businessProfile.cancelButton')}
                    </Button>
                    <Button type="submit" variant="primary">
                      {t('businessProfile.saveButton')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </form>
        </div>
      ) : (
        <div id="business-profile-panel-branches" role="tabpanel" aria-labelledby="business-profile-tab-branches">
          <BranchesTab
            branches={branches}
            canManage={canManage}
            onAdd={() => setBranchModal({ kind: 'create' })}
            onEdit={(branch) => setBranchModal({ kind: 'edit', branch })}
            t={t}
          />
        </div>
      )}

      <Dialog
        open={pendingTab !== null}
        onClose={() => setPendingTab(null)}
        title={t('businessProfile.leaveDialogTitle')}
        closeLabel={t('businessProfile.leaveDialogCloseLabel')}
        tone="warning"
      >
        <Text variant="body">{t('businessProfile.leaveDialogBody')}</Text>
        <div className={styles.dialogActions}>
          <Button variant="primary" onClick={() => setPendingTab(null)}>
            {t('businessProfile.leaveDialogStayButton')}
          </Button>
          <Button variant="danger" onClick={discardAndSwitchTab}>
            {t('businessProfile.leaveDialogLeaveButton')}
          </Button>
        </div>
      </Dialog>

      {branchModal && (
        <BranchModal mode={branchModal} onClose={() => setBranchModal(null)} onSaved={handleBranchSaved} t={t} />
      )}
    </div>
  );
}

function ReadOnlyDetails({ profile, t }: { profile: BusinessProfile; t: (key: string) => string }) {
  const category = normalizeBusinessCategory(profile.category);
  return (
    <div className={styles.fields}>
      <ReadOnlyRow label={t('businessProfile.nameLabel')} value={profile.name} />
      {profile.nameHe && <ReadOnlyRow label={t('businessProfile.nameHeLabel')} value={profile.nameHe} />}
      <div className={styles.lockedRow}>
        <Text variant="label" as="span" className={styles.lockedLabel}>
          <LockIcon /> {t('businessProfile.registrationNumberLabel')}
        </Text>
        <span dir="ltr">{profile.registrationNumber ?? '—'}</span>
      </div>
      <ReadOnlyRow label={t('businessProfile.categoryLabel')} value={t(`businessProfile.${categoryLabelKey(category)}`)} />
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readOnlyRow}>
      <Text variant="caption" as="span">
        {label}
      </Text>
      <Text variant="label" as="span">
        {value}
      </Text>
    </div>
  );
}

function LogoCard({ profile, lang, t }: { profile: BusinessProfile; lang: 'HE' | 'EN'; t: (key: string) => string }) {
  const initial = displayName(profile, lang).trim().charAt(0).toUpperCase();
  return (
    <Card className={styles.logoCard}>
      <span className={styles.logoAvatar} aria-hidden="true">
        {initial}
      </span>
      <div className={styles.logoText}>
        <Text variant="label" as="p">
          {t('businessProfile.logoTitle')}
        </Text>
        <Text variant="caption">{t('businessProfile.logoNoneCaption')}</Text>
      </div>
      {/* Disabled, not hidden — same "advertise it's coming" idiom AppShell
          uses for Overview/Analytics: there is genuinely no upload storage
          behind this yet (see the PR notes), so the control stays visible
          but inert rather than silently missing. */}
      <Button type="button" variant="secondary" disabled title={t('shell.comingSoonBadge')}>
        <UploadIcon /> {t('businessProfile.logoUploadButton')}
      </Button>
    </Card>
  );
}

// The business's real OWNER member — server-resolved (BusinessProfileOut.
// ownerName/ownerEmail, see its own comment), never the logged-in caller.
// A MANAGER or CASHIER viewing this page must see the actual owner here,
// not themselves.
function ContactCard({ profile, t }: { profile: BusinessProfile; t: (key: string) => string }) {
  const name = profile.ownerName ?? '—';
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <Card className={styles.contactCard}>
      <Heading level={3}>{t('businessProfile.contactTitle')}</Heading>
      <div className={styles.contactRow}>
        <span className={styles.contactAvatar} aria-hidden="true">
          {initial}
        </span>
        <div>
          <Text variant="label" as="p">
            {name}
          </Text>
          <span className={styles.contactBadge}>
            <BadgeCheckIcon /> {t('businessProfile.contactOwnerBadge')}
          </span>
        </div>
      </div>
      {profile.ownerEmail && (
        <div className={styles.contactDetail}>
          <MailIcon />
          <span dir="ltr">{profile.ownerEmail}</span>
        </div>
      )}
    </Card>
  );
}

function BranchesTab({
  branches,
  canManage,
  onAdd,
  onEdit,
  t,
}: {
  branches: Branch[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (branch: Branch) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={styles.branchesWrap}>
      <div className={styles.branchesHeader}>
        <Heading level={2}>{t('businessProfile.branchesSectionTitle')}</Heading>
        <div className={styles.saveBarSpacer} />
        {canManage && (
          <Button type="button" variant="secondary" onClick={onAdd}>
            <PlusIcon /> {t('businessProfile.addBranchButton')}
          </Button>
        )}
      </div>
      {branches.map((branch) => (
        <Card key={branch.id} className={styles.branchCard}>
          <span className={styles.branchIcon} aria-hidden="true">
            <MapPinIcon />
          </span>
          <div className={styles.branchInfo}>
            {branch.name && (
              <Text variant="label" as="p">
                {branch.name}
              </Text>
            )}
            <Text variant="caption">{branch.address ?? t('businessProfile.branchesNoAddress')}</Text>
          </div>
          <StatusBadge tone={branch.isActive ? 'success' : 'neutral'}>
            {t(branch.isActive ? 'businessProfile.branchStatusActive' : 'businessProfile.branchStatusInactive')}
          </StatusBadge>
          {canManage && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onEdit(branch)}
              aria-label={t('businessProfile.branchesEditButton')}
            >
              <PencilIcon />
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

type BranchSaveStep = 'form' | 'geocoding' | 'geocodeError' | 'confirmLocation';

// The same geocode-then-confirm detour `BusinessRegistrationPage` and the
// Business Details tab (before location moved here) both use — reused via
// `geocodeAddress`/`LocationConfirmMap` rather than a second implementation,
// just orchestrated locally since this dialog is the only caller that scopes
// it to one branch instead of a whole page.
function BranchModal({
  mode,
  onClose,
  onSaved,
  t,
}: {
  mode: BranchModalMode;
  onClose: () => void;
  onSaved: (branch: Branch) => void;
  t: (key: string) => string;
}) {
  const isEdit = mode.kind === 'edit';
  const initial = mode.kind === 'edit' ? mode.branch : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [addressError, setAddressError] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const [step, setStep] = useState<BranchSaveStep>('form');
  const [geocodeErrorReason, setGeocodeErrorReason] = useState<'rate_limited' | 'unavailable' | null>(null);
  const [pendingLat, setPendingLat] = useState<number | null>(initial?.locationLat ?? null);
  const [pendingLng, setPendingLng] = useState<number | null>(initial?.locationLng ?? null);

  function handleResult(result: BranchResult) {
    setStep('form');
    if (result.outcome === 'ok') {
      onSaved(result.branch);
      return;
    }
    setSaveState('error');
    setSaveErrorMessage(
      result.outcome === 'conflict' && result.code === 'LAST_ACTIVE_BRANCH'
        ? t('businessProfile.branchLastActiveError')
        : t('businessProfile.branchSaveErrorMessage'),
    );
  }

  async function doSave(coords: { lat: number; lng: number } | null) {
    setSaveState('saving');
    setSaveErrorMessage(null);
    const trimmedName = name.trim();

    if (mode.kind === 'edit') {
      const base = { name: trimmedName === '' ? null : trimmedName, isActive };
      const payload: BranchUpdatePayload = coords
        ? { ...base, address: address.trim(), locationLat: coords.lat, locationLng: coords.lng }
        : base;
      handleResult(await updateBranch(mode.branch.id, payload));
      return;
    }

    // A new branch always supplies address and coordinates together —
    // `handleSubmit` never reaches here without them (see below).
    if (!coords) return;
    const payload: BranchCreatePayload = {
      name: trimmedName === '' ? null : trimmedName,
      address: address.trim(),
      locationLat: coords.lat,
      locationLng: coords.lng,
    };
    handleResult(await createBranch(payload));
  }

  async function runGeocode() {
    setStep('geocoding');
    const result = await geocodeAddress(address);
    if (result.outcome === 'found') {
      setPendingLat(result.lat);
      setPendingLng(result.lng);
      setStep('confirmLocation');
    } else if (result.outcome === 'not_found') {
      setPendingLat(null);
      setPendingLng(null);
      setStep('confirmLocation');
    } else {
      setGeocodeErrorReason(result.outcome);
      setStep('geocodeError');
    }
  }

  function useManualLocation() {
    setPendingLat(null);
    setPendingLng(null);
    setStep('confirmLocation');
  }

  function confirmLocationAndSave() {
    if (pendingLat === null || pendingLng === null) return;
    void doSave({ lat: pendingLat, lng: pendingLng });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saveState === 'saving') return;

    const trimmedAddress = address.trim();
    if (trimmedAddress.length < 2) {
      setAddressError(t('businessProfile.validationAddressRequired'));
      return;
    }
    setAddressError(undefined);

    const addressChanged = !isEdit || trimmedAddress !== (initial?.address ?? '').trim();
    if (addressChanged) {
      void runGeocode();
      return;
    }
    void doSave(null);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(isEdit ? 'businessProfile.branchModalEditTitle' : 'businessProfile.branchModalAddTitle')}
      closeLabel={t('businessProfile.leaveDialogCloseLabel')}
      size="lg"
    >
      {step === 'geocoding' && <LoadingState label={t('businessRegistration.geocodingLabel')} />}

      {step === 'geocodeError' && (
        <>
          <Heading level={3}>
            {t(
              geocodeErrorReason === 'rate_limited'
                ? 'businessRegistration.geocodeRateLimitedTitle'
                : 'businessRegistration.geocodeUnavailableTitle',
            )}
          </Heading>
          <Text variant="body">
            {t(
              geocodeErrorReason === 'rate_limited'
                ? 'businessRegistration.geocodeRateLimitedMessage'
                : 'businessRegistration.geocodeUnavailableMessage',
            )}
          </Text>
          <div className={styles.dialogActions}>
            <Button type="button" onClick={() => void runGeocode()}>
              {t('businessRegistration.geocodeRetryButton')}
            </Button>
            <Button type="button" variant="secondary" onClick={useManualLocation}>
              {t('businessRegistration.geocodeManualLocationButton')}
            </Button>
            <Button type="button" variant="text" onClick={() => setStep('form')}>
              {t('businessProfile.cancelButton')}
            </Button>
          </div>
        </>
      )}

      {step === 'confirmLocation' && (
        <>
          <Heading level={3}>{t('businessRegistration.confirmLocationTitle')}</Heading>
          <Text variant="body">
            {t(
              pendingLat !== null
                ? 'businessRegistration.confirmLocationFoundSubtitle'
                : 'businessRegistration.confirmLocationNotFoundSubtitle',
            )}
          </Text>
          <LocationConfirmMap
            latitude={pendingLat}
            longitude={pendingLng}
            onChange={(lat, lng) => {
              setPendingLat(lat);
              setPendingLng(lng);
            }}
            latLabel={t('businessRegistration.latLabel')}
            lngLabel={t('businessRegistration.lngLabel')}
          />
          <Text variant="caption">{t('businessRegistration.osmAttributionNote')}</Text>
          <div className={styles.dialogActions}>
            <Button
              type="button"
              disabled={pendingLat === null || pendingLng === null || saveState === 'saving'}
              onClick={confirmLocationAndSave}
            >
              {saveState === 'saving' ? t('businessProfile.savingLabel') : t('businessRegistration.confirmLocationContinueButton')}
            </Button>
            <Button type="button" variant="secondary" disabled={saveState === 'saving'} onClick={() => setStep('form')}>
              {t('businessRegistration.confirmLocationBackButton')}
            </Button>
          </div>
        </>
      )}

      {step === 'form' && (
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.fields}>
            <Input
              label={t('businessProfile.branchNameLabel')}
              helperText={t('businessProfile.branchNameHint')}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              label={t('businessProfile.addressLabel')}
              required
              maxLength={200}
              value={address}
              error={addressError}
              onChange={(event) => setAddress(event.target.value)}
            />
            {isEdit && (
              <Switch
                label={t('businessProfile.branchActiveToggleLabel')}
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
            )}
            {saveState === 'error' && saveErrorMessage && (
              <Text variant="caption" role="alert" className={styles.branchErrorText}>
                {saveErrorMessage}
              </Text>
            )}
          </div>
          <div className={styles.dialogActions}>
            <Button type="submit" variant="primary" disabled={saveState === 'saving'}>
              {saveState === 'saving' ? t('businessProfile.savingLabel') : t('businessProfile.branchSaveButton')}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saveState === 'saving'}>
              {t('businessProfile.cancelButton')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22v-4h6v4M9 6h1M14 6h1M9 10h1M14 10h1M9 14h1M14 14h1" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 16V4M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="m17 3 4 4L7 21H3v-4Z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BadgeCheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="m9 12 2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}
