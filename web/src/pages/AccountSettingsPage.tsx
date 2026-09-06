import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBusinessRole } from '@/lib/auth/businessRole';
import { applySelfNameChange } from '@/lib/auth/selfProfile';
import { updateName } from '@/lib/api/profile';
import { Card, Heading, Text, Button, Input, Dialog, PageHeader } from '@/components/ui';
import { CheckCircleIcon, AlertTriangleIcon } from '@/components/ui/icons';
import type { AuthUser } from '@/lib/auth/types';
import styles from './AccountSettingsPage.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type FormState = { name: string };

function formFromUser(user: AuthUser): FormState {
  return { name: user.name ?? '' };
}

// 'OWNER' -> 'roleLabelOwner', matching `permissions.roleLabel*` — reused
// rather than duplicated, since it names the same business role either page
// shows.
function roleLabelKey(role: 'OWNER' | 'MANAGER' | 'CASHIER'): string {
  return `permissions.roleLabel${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}

const SAVED_BANNER_MS = 3000;

export function AccountSettingsPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  const [form, setForm] = useState<FormState>(() => (user ? formFromUser(user) : { name: '' }));
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const savedBannerTimeout = useRef<number | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(savedBannerTimeout.current), []);

  const dirty = user !== null && JSON.stringify(form) !== JSON.stringify(formFromUser(user));

  // Same reasoning as BusinessProfilePage's own guard (CAR-341): a save the
  // user has already typed over must not vanish to a background tab
  // close/refresh.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = t('accountSettings.beforeUnloadWarning');
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, t]);

  if (!user) return null;

  const role = normalizeBusinessRole(user.businessMembershipRole);
  const initial = (user.name ?? '?').trim().charAt(0).toUpperCase();

  function handleCancel() {
    setForm(formFromUser(user));
    setNameError(undefined);
    setSaveState('idle');
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saveState === 'saving') return;

    const trimmed = form.name.trim();
    if (trimmed.length < 2) {
      setNameError(t('accountSettings.nameValidationError'));
      nameRef.current?.focus();
      return;
    }

    setNameError(undefined);
    setSaveState('saving');
    const result = await updateName(trimmed);

    if (result.outcome === 'ok') {
      await applySelfNameChange(user.id, result.name);
      setForm({ name: result.name ?? '' });
      setSaveState('saved');
      window.clearTimeout(savedBannerTimeout.current);
      savedBannerTimeout.current = window.setTimeout(() => setSaveState('idle'), SAVED_BANNER_MS);
      return;
    }
    setSaveState('error');
  }

  function handleLogoutClick() {
    if (dirty) {
      setLogoutDialogOpen(true);
      return;
    }
    void logout();
  }

  function confirmLogoutWithoutSaving() {
    setLogoutDialogOpen(false);
    void logout();
  }

  return (
    <div>
      <PageHeader title={t('accountSettings.title')} subtitle={t('accountSettings.subtitle')} />

      <form onSubmit={handleSave} noValidate>
        <div className={styles.layout}>
          <Card className={styles.identityCard}>
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <div className={styles.identityText}>
              <Text variant="label" as="p">
                {user.name ?? '—'}
              </Text>
              {role && <Text variant="caption">{t(roleLabelKey(role))}</Text>}
            </div>
          </Card>

          <Card className={styles.card}>
            <Heading level={3}>{t('accountSettings.detailsTitle')}</Heading>
            <div className={styles.fields}>
              <Input
                ref={nameRef}
                label={t('accountSettings.nameLabel')}
                required
                maxLength={80}
                value={form.name}
                error={nameError}
                onChange={(event) => setForm({ name: event.target.value })}
              />
              <LockedField
                icon={<LockIcon />}
                label={t('accountSettings.emailLabel')}
                value={user.email}
                caption={t('accountSettings.emailLockedCaption')}
              />
              <LockedField
                icon={<LockIcon />}
                label={t('accountSettings.phoneLabel')}
                value={user.phone ?? null}
                fallback={t('accountSettings.phoneUnavailable')}
                caption={t('accountSettings.phoneLockedCaption')}
              />
            </div>
          </Card>

          <Card className={styles.rowCard}>
            <span className={styles.rowIcon} aria-hidden="true">
              <KeyRoundIcon />
            </span>
            <div className={styles.rowText}>
              <Text variant="label" as="p">
                {t('accountSettings.passwordTitle')}
              </Text>
              <Text variant="caption">{t('accountSettings.passwordSubtitle')}</Text>
            </div>
            <Button type="button" variant="secondary" onClick={() => setPasswordDialogOpen(true)}>
              {t('accountSettings.passwordComingSoonBadge')}
            </Button>
          </Card>

          <Card className={styles.rowCard}>
            <span className={styles.rowIcon} aria-hidden="true">
              <LogOutIcon />
            </span>
            <div className={styles.rowText}>
              <Text variant="label" as="p">
                {t('accountSettings.logoutTitle')}
              </Text>
              <Text variant="caption">{t('accountSettings.logoutSubtitle')}</Text>
            </div>
            <Button type="button" variant="secondary" leadingIcon={<LogOutIcon />} onClick={handleLogoutClick}>
              {t('accountSettings.logoutButton')}
            </Button>
          </Card>
        </div>

        {(dirty || saveState !== 'idle') && (
          <div className={styles.saveBar} data-state={saveState}>
            {saveState === 'saving' ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                <Text variant="label" as="span">
                  {t('accountSettings.savingLabel')}
                </Text>
              </>
            ) : saveState === 'saved' ? (
              <>
                <CheckCircleIcon />
                <Text variant="label" as="span">
                  {t('accountSettings.savedLabel')}
                </Text>
              </>
            ) : saveState === 'error' ? (
              <>
                <AlertTriangleIcon />
                <Text variant="label" as="span" role="alert">
                  {t('accountSettings.saveErrorMessage')}
                </Text>
                <div className={styles.saveBarSpacer} />
                <Button type="submit" variant="secondary" size="sm">
                  {t('accountSettings.saveRetryButton')}
                </Button>
              </>
            ) : (
              <>
                <span className={styles.unsavedDot} aria-hidden="true" />
                <Text variant="label" as="span">
                  {t('accountSettings.unsavedChangesLabel')}
                </Text>
                <div className={styles.saveBarSpacer} />
                <Button type="button" variant="secondary" onClick={handleCancel}>
                  {t('accountSettings.cancelButton')}
                </Button>
                <Button type="submit" variant="primary">
                  {t('accountSettings.saveButton')}
                </Button>
              </>
            )}
          </div>
        )}
      </form>

      <Dialog
        open={passwordDialogOpen}
        onClose={() => setPasswordDialogOpen(false)}
        title={t('accountSettings.passwordDialogTitle')}
        closeLabel={t('accountSettings.passwordDialogCloseLabel')}
      >
        <Text variant="body">{t('accountSettings.passwordDialogBody')}</Text>
        <div className={styles.dialogActions}>
          <Button variant="primary" onClick={() => setPasswordDialogOpen(false)}>
            {t('accountSettings.passwordDialogCloseButton')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={logoutDialogOpen}
        onClose={() => setLogoutDialogOpen(false)}
        title={t('accountSettings.logoutDialogTitle')}
        closeLabel={t('accountSettings.logoutDialogCloseLabel')}
        tone="warning"
      >
        <Text variant="body">{t('accountSettings.logoutDialogBody')}</Text>
        <div className={styles.dialogActions}>
          <Button variant="primary" onClick={() => setLogoutDialogOpen(false)}>
            {t('accountSettings.logoutDialogStayButton')}
          </Button>
          <Button variant="danger" onClick={confirmLogoutWithoutSaving}>
            {t('accountSettings.logoutDialogLeaveButton')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function LockedField({
  icon,
  label,
  value,
  fallback = '—',
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  fallback?: string;
  caption: string;
}) {
  return (
    <div className={styles.lockedFieldGroup}>
      <div className={styles.lockedRow}>
        <Text variant="label" as="span" className={styles.lockedLabel}>
          {icon} {label}
        </Text>
        <span dir="ltr" className={styles.lockedValue}>
          {value ?? fallback}
        </span>
      </div>
      <div className={styles.infoLine}>
        <InfoIcon />
        <Text variant="caption" as="span">
          {caption}
        </Text>
      </div>
    </div>
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

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function KeyRoundIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 .707-.293l1.414-1.414" />
      <circle cx="16.5" cy="7.5" r="5.5" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
