import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasBusinessRole } from '@/lib/auth/businessRole';
import {
  deleteRewardPermanently,
  getLiveVoucherCount,
  listRewards,
  reactivateReward,
  restoreRewardFromTrash,
  retireReward,
  setRewardActive,
  trashReward,
  type Reward,
} from '@/lib/api/rewards';
import { BUSINESS_CATEGORIES, isBusinessCategory, normalizeBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import {
  categoryTranslationKey,
  getRewardState,
  isArchived,
  isTrashed,
  localizedRewardText,
  matchesTab,
  type RewardState,
  type RewardTab,
} from '@/lib/rewardState';
import { RewardForm } from '@/components/business/RewardForm';
import { Alert, Card, Heading, Text, Button, Dialog, ErrorState, EmptyState, Input, StatusBadge, CountBadge, Skeleton, CategoryIcon } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RewardsPage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';

// The retire (archive) dialog must never let a business proceed on a guessed
// or stale count (CAR-115) — 'loading' and 'error' both keep the confirm
// button disabled, only 'ok' with a real server count unlocks it.
type LiveVoucherCheck = { status: 'loading' } | { status: 'error' } | { status: 'ok'; count: number };

type FormState = { mode: 'create' } | { mode: 'edit'; reward: Reward };

const STATE_KEY: Record<RewardState, keyof TranslationMap['rewards']> = {
  active: 'stateActive',
  soldOut: 'stateSoldOut',
  expired: 'stateExpired',
  inactive: 'stateInactive',
  endingSoon: 'stateEndingSoon',
};

const TAB_KEY: Record<RewardTab, keyof TranslationMap['rewards']> = {
  all: 'filterAll',
  active: 'filterActive',
  paused: 'filterPaused',
  ended: 'filterEnded',
  archived: 'filterArchived',
  trash: 'filterTrash',
};

const TABS: RewardTab[] = ['all', 'active', 'paused', 'ended', 'archived', 'trash'];

function matchesSearch(reward: Reward, query: string): boolean {
  if (query === '') return true;
  const haystack = `${reward.titleHe} ${reward.titleEn ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

export function RewardsPage() {
  const { t, lang } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [activeTab, setActiveTab] = useState<RewardTab>('all');
  const [search, setSearch] = useState('');
  const [retireTarget, setRetireTarget] = useState<Reward | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [retireErrors, setRetireErrors] = useState<Record<string, string>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const [liveVoucherCheck, setLiveVoucherCheck] = useState<LiveVoucherCheck>({ status: 'loading' });
  // Guards a second DELETE from firing before the confirm dialog's buttons
  // re-render disabled — same convention as RedemptionPage's redeemInFlight.
  const retireInFlight = useRef(false);
  // Discards a stale live-voucher-count response — the dialog was closed and
  // reopened, for the same or a different reward, before the earlier request
  // resolved — so a slow first fetch can never overwrite a later one's result.
  const liveVoucherRequestId = useRef(0);

  // Move-to-trash — its own confirm dialog and live-voucher check,
  // mirroring the archive dialog above, but the count *blocks* the confirm
  // button once nonzero rather than only warning: the server hard-refuses a
  // trash with a live voucher outstanding.
  const [trashTarget, setTrashTarget] = useState<Reward | null>(null);
  const [trashingId, setTrashingId] = useState<string | null>(null);
  const [trashErrors, setTrashErrors] = useState<Record<string, string>>({});
  const [trashLiveVoucherCheck, setTrashLiveVoucherCheck] = useState<LiveVoucherCheck>({ status: 'loading' });
  const trashInFlight = useRef(false);
  const trashLiveVoucherRequestId = useRef(0);

  // Restore (Trash -> Archive) and reactivate (Archive -> Active) are each a
  // single explicit step — no confirm dialog, since neither removes
  // anything or touches a voucher.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>({});
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reactivateErrors, setReactivateErrors] = useState<Record<string, string>>({});

  // Permanent delete — only ever reached from the Trash tab.
  const [deleteTarget, setDeleteTarget] = useState<Reward | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const deleteInFlight = useRef(false);

  // A one-off confirmation banner: restoring from trash moves the
  // reward out of the tab the business was just looking at, so a card
  // disappearing on its own isn't enough feedback that it landed safely in
  // Archive rather than vanishing.
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Any lifecycle mutation in flight, for any reward — the broadest form of
  // the same cross-action guard `handleToggleActive`'s own comment explains:
  // with six independent actions now touching the same rows (pause/resume,
  // archive, trash, restore, reactivate, permanent delete), disabling only
  // the pair that used to collide would miss the rest.
  const lifecycleActionInFlight =
    togglingId !== null ||
    retiringId !== null ||
    trashingId !== null ||
    restoringId !== null ||
    reactivatingId !== null ||
    deletingId !== null;

  const defaultCategory = useMemo<BusinessCategory>(() => {
    const category = user?.businessCategory?.toLowerCase() ?? '';
    return isBusinessCategory(category) ? category : BUSINESS_CATEGORIES[0];
  }, [user]);

  // CAR-116: a CASHIER reaches this page for the active-rewards view the
  // matrix grants it (the server already filters the list to active-only —
  // see GET /api/business/rewards), but none of create/edit/archive/pause.
  // Hiding the controls, not disabling them, matches RequireBusinessRole's
  // own "don't advertise what a role can't use" rule one level up.
  const canManage = hasBusinessRole(user?.businessMembershipRole, ['OWNER', 'MANAGER']);

  function applyListResult(result: Awaited<ReturnType<typeof listRewards>>) {
    if (result.outcome === 'ok') {
      setRewards(result.rewards);
      setStatus('ready');
    } else if (result.outcome === 'forbidden') {
      setStatus('forbidden');
    } else {
      setStatus('error');
    }
  }

  // `.then()` inline in the effect, not a `setState`-containing async
  // function called from it — same shape as AuthProvider's bootstrap effect.
  // `cancelled` drops a result that resolves after this instance has already
  // unmounted (StrictMode's double-invoke on mount, or a fast navigation
  // away from the page).
  useEffect(() => {
    let cancelled = false;
    listRewards().then((result) => {
      if (!cancelled) applyListResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setStatus('loading');
    listRewards().then(applyListResult);
  }

  // Triggered from the retire button's click handler, not a `useEffect` keyed
  // on `retireTarget` — the fetch must start the moment the dialog opens, and
  // starting it here means `liveVoucherCheck` can reset to 'loading'
  // synchronously in the same event instead of flashing a stale result.
  function openRetireDialog(reward: Reward) {
    setRetireTarget(reward);
    setLiveVoucherCheck({ status: 'loading' });
    const requestId = ++liveVoucherRequestId.current;
    getLiveVoucherCount(reward.id).then((result) => {
      if (liveVoucherRequestId.current !== requestId) return;
      setLiveVoucherCheck(result.outcome === 'ok' ? { status: 'ok', count: result.liveVouchers } : { status: 'error' });
    });
  }

  function handleSaved(reward: Reward) {
    setRewards((prev) => {
      const index = prev.findIndex((r) => r.id === reward.id);
      if (index === -1) return [reward, ...prev];
      const next = [...prev];
      next[index] = reward;
      return next;
    });
    setFormState(null);
  }

  async function handleToggleActive(reward: Reward) {
    // Also bails while any other lifecycle action is in flight (for this
    // reward or any other) — same cross-action guard the buttons below
    // enforce, so a pause/resume PATCH can never race the reward's own
    // archive/trash/restore/reactivate/delete call.
    if (lifecycleActionInFlight) return;
    setTogglingId(reward.id);
    const result = await setRewardActive(reward.id, !reward.isActive);
    setTogglingId(null);

    if (result.outcome === 'ok') {
      setRewards((prev) => prev.map((r) => (r.id === reward.id ? result.reward : r)));
      setToggleErrors((prev) => {
        if (!(reward.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[reward.id];
        return rest;
      });
      return;
    }
    setToggleErrors((prev) => ({
      ...prev,
      [reward.id]: t(reward.isActive ? 'rewards.pauseErrorMessage' : 'rewards.resumeErrorMessage'),
    }));
  }

  async function handleConfirmRetire() {
    // lifecycleActionInFlight here would mean some other action for this
    // reward (or another) started after the dialog opened but before this
    // confirm ran — the button that opens this dialog is itself disabled
    // while any other action is in flight, so this is a defensive second
    // gate on the same cross-action rule.
    if (!retireTarget || retireInFlight.current || lifecycleActionInFlight || liveVoucherCheck.status !== 'ok') return;
    const target = retireTarget;
    retireInFlight.current = true;
    setRetiringId(target.id);
    const result = await retireReward(target.id);
    retireInFlight.current = false;
    setRetiringId(null);
    setRetireTarget(null);

    if (result.outcome === 'ok') {
      // Updated in place, not removed — the reward still belongs in local
      // state under the Archived tab (matchesTab), the same "map, don't
      // filter" shape handleToggleActive uses for its own PATCH response.
      // DELETE returns no body (see retireReward), so there's no server
      // reward to merge; `archivedAt: now` mirrors what the server just set
      // (`archived_at = datetime.now(UTC)` in services/business.py) closely
      // enough — nothing in the UI renders the exact archive timestamp,
      // only whether it's set.
      const archivedAt = new Date().toISOString();
      setRewards((prev) => prev.map((r) => (r.id === target.id ? { ...r, archivedAt } : r)));
      setRetireErrors((prev) => {
        if (!(target.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[target.id];
        return rest;
      });
      return;
    }
    setRetireErrors((prev) => ({ ...prev, [target.id]: t('rewards.retireErrorMessage') }));
  }

  // Same shape as openRetireDialog, its own request-id ref so a stale
  // response from a previous trash dialog can never overwrite this one's.
  function openTrashDialog(reward: Reward) {
    setTrashTarget(reward);
    setTrashLiveVoucherCheck({ status: 'loading' });
    const requestId = ++trashLiveVoucherRequestId.current;
    getLiveVoucherCount(reward.id).then((result) => {
      if (trashLiveVoucherRequestId.current !== requestId) return;
      setTrashLiveVoucherCheck(
        result.outcome === 'ok' ? { status: 'ok', count: result.liveVouchers } : { status: 'error' },
      );
    });
  }

  async function handleConfirmTrash() {
    // Unlike retire, a nonzero count keeps this disabled — the server 409s
    // outright rather than warning, so there is nothing to confirm past it.
    if (
      !trashTarget ||
      trashInFlight.current ||
      lifecycleActionInFlight ||
      trashLiveVoucherCheck.status !== 'ok' ||
      trashLiveVoucherCheck.count > 0
    ) {
      return;
    }
    const target = trashTarget;
    trashInFlight.current = true;
    setTrashingId(target.id);
    const result = await trashReward(target.id);
    trashInFlight.current = false;
    setTrashingId(null);

    if (result.outcome === 'ok') {
      setTrashTarget(null);
      const now = new Date().toISOString();
      // Mirrors trash_reward (services/business.py): archivedAt is set too
      // when it wasn't already, so a reward trashed straight from Active
      // still shows the same Archive stopover restoring will land it back in.
      setRewards((prev) =>
        prev.map((r) => (r.id === target.id ? { ...r, trashedAt: now, archivedAt: r.archivedAt ?? now } : r)),
      );
      setTrashErrors((prev) => {
        if (!(target.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[target.id];
        return rest;
      });
      return;
    }
    if (result.outcome === 'has_live_vouchers') {
      // A voucher went live between the pre-check and this confirm (or the
      // dialog was left open a while) — re-run the check rather than closing
      // the dialog, so the business sees why it was refused.
      setTrashLiveVoucherCheck({ status: 'loading' });
      const recheck = await getLiveVoucherCount(target.id);
      setTrashLiveVoucherCheck(
        recheck.outcome === 'ok' ? { status: 'ok', count: recheck.liveVouchers } : { status: 'error' },
      );
      return;
    }
    setTrashTarget(null);
    setTrashErrors((prev) => ({ ...prev, [target.id]: t('rewards.trashErrorMessage') }));
  }

  async function handleRestore(reward: Reward) {
    if (lifecycleActionInFlight) return;
    setRestoringId(reward.id);
    const result = await restoreRewardFromTrash(reward.id);
    setRestoringId(null);

    if (result.outcome === 'ok') {
      setRewards((prev) => prev.map((r) => (r.id === reward.id ? { ...r, trashedAt: null } : r)));
      setRestoreErrors((prev) => {
        if (!(reward.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[reward.id];
        return rest;
      });
      // Restoring moves the card out of the Trash tab the business is
      // looking at right now — surfaced explicitly rather than
      // letting it silently vanish from the list.
      setActiveTab('archived');
      setSuccessBanner(t('rewards.restoreSuccessMessage'));
      return;
    }
    setRestoreErrors((prev) => ({ ...prev, [reward.id]: t('rewards.restoreErrorMessage') }));
  }

  async function handleReactivate(reward: Reward) {
    if (lifecycleActionInFlight) return;
    setReactivatingId(reward.id);
    const result = await reactivateReward(reward.id);
    setReactivatingId(null);

    if (result.outcome === 'ok') {
      setRewards((prev) => prev.map((r) => (r.id === reward.id ? { ...r, archivedAt: null } : r)));
      setReactivateErrors((prev) => {
        if (!(reward.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[reward.id];
        return rest;
      });
      return;
    }
    setReactivateErrors((prev) => ({ ...prev, [reward.id]: t('rewards.reactivateErrorMessage') }));
  }

  async function handleConfirmDelete() {
    if (!deleteTarget || deleteInFlight.current || lifecycleActionInFlight) return;
    const target = deleteTarget;
    deleteInFlight.current = true;
    setDeletingId(target.id);
    const result = await deleteRewardPermanently(target.id);
    deleteInFlight.current = false;
    setDeletingId(null);
    setDeleteTarget(null);

    if (result.outcome === 'ok') {
      // Removed, not updated — a permanently deleted reward must not
      // resurface in any tab, unlike every other lifecycle step.
      setRewards((prev) => prev.filter((r) => r.id !== target.id));
      setDeleteErrors((prev) => {
        if (!(target.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[target.id];
        return rest;
      });
      return;
    }
    setDeleteErrors((prev) => ({ ...prev, [target.id]: t('rewards.deletePermanentlyErrorMessage') }));
  }

  const nonArchived = useMemo(() => rewards.filter((r) => !isArchived(r) && !isTrashed(r)), [rewards]);
  const activeCount = useMemo(() => rewards.filter((r) => matchesTab(r, 'active')).length, [rewards]);

  const tabCounts = useMemo(() => {
    const counts: Record<RewardTab, number> = { all: 0, active: 0, paused: 0, ended: 0, archived: 0, trash: 0 };
    for (const tab of TABS) counts[tab] = rewards.filter((r) => matchesTab(r, tab)).length;
    return counts;
  }, [rewards]);

  const searchQuery = search.trim().toLowerCase();
  const visibleRewards = useMemo(
    () => rewards.filter((r) => matchesTab(r, activeTab) && matchesSearch(r, searchQuery)),
    [rewards, activeTab, searchQuery],
  );

  if (status === 'loading') {
    return (
      <div role="status" aria-label={t('rewards.loadingLabel')} className={styles.grid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className={styles.card}>
            <Skeleton height={88} className={styles.skeletonBlock} />
            <Skeleton width="70%" height={14} />
            <Skeleton width="45%" height={11} />
            <Skeleton width="55%" height={11} />
          </Card>
        ))}
      </div>
    );
  }

  if (status === 'forbidden') {
    return <ErrorState title={t('rewards.forbiddenTitle')} message={t('rewards.forbiddenMessage')} />;
  }

  if (status === 'error') {
    return (
      <ErrorState
        title={t('rewards.loadErrorTitle')}
        message={t('rewards.loadErrorMessage')}
        onRetry={retry}
        retryLabel={t('rewards.retryButton')}
      />
    );
  }

  const noRewardsAtAll = rewards.length === 0;

  return (
    <div>
      <div className={styles.header}>
        <div>
          <Heading level={1}>{t('rewards.title')}</Heading>
          <Text variant="body">
            {canManage
              ? t('rewards.countSummary').replace('{total}', String(nonArchived.length)).replace('{active}', String(activeCount))
              : t('rewards.subtitleReadOnly')}
          </Text>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setFormState({ mode: 'create' })}>
            {t('rewards.createButton')}
          </Button>
        )}
      </div>

      {successBanner && (
        <Alert tone="success" title={successBanner} className={styles.banner} onClick={() => setSuccessBanner(null)} />
      )}

      {!noRewardsAtAll && (
        <div className={styles.toolbar}>
          {canManage && (
            // Plain buttons filtering one grid, not a tabpanel-switching
            // widget, so this deliberately reaches for `aria-current`
            // rather than the full ARIA tabs pattern (role="tablist"/"tab"
            // + arrow-key navigation) — `aria-current="true"` is the
            // correct, honest way to expose "the currently selected item in
            // a set of related filters" without committing to keyboard
            // behaviour this widget doesn't implement.
            <div className={styles.tabs}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={styles.tab}
                  aria-current={activeTab === tab ? 'true' : undefined}
                  onClick={() => setActiveTab(tab)}
                >
                  {t(`rewards.${TAB_KEY[tab]}`)} <CountBadge>{tabCounts[tab]}</CountBadge>
                </button>
              ))}
            </div>
          )}
          <Input
            variant="search"
            aria-label={t('rewards.searchPlaceholder')}
            placeholder={t('rewards.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.search}
          />
        </div>
      )}

      {noRewardsAtAll ? (
        <EmptyState
          title={t('rewards.emptyTitle')}
          message={t(canManage ? 'rewards.emptyMessage' : 'rewards.emptyMessageReadOnly')}
        />
      ) : visibleRewards.length === 0 ? (
        // The "all" tab excludes archived rewards by definition (matchesTab),
        // so an empty "all" view — regardless of search text — means the
        // catalog genuinely has nothing to manage, not "no matches": an
        // archive-only catalog still gets the create-oriented empty state,
        // and the reward stays one Archived-tab click away.
        activeTab === 'all' && nonArchived.length === 0 ? (
          <EmptyState
            title={t('rewards.emptyTitle')}
            message={t(canManage ? 'rewards.emptyMessage' : 'rewards.emptyMessageReadOnly')}
          />
        ) : (
          <EmptyState
            title={
              activeTab === 'archived'
                ? t('rewards.filterArchived')
                : activeTab === 'trash'
                  ? t('rewards.filterTrash')
                  : t('rewards.noResultsTitle')
            }
            message={
              activeTab === 'archived'
                ? t('rewards.archivedEmptyMessage')
                : activeTab === 'trash'
                  ? t('rewards.trashEmptyMessage')
                  : t('rewards.noResultsMessage')
            }
          />
        )
      ) : (
        <div className={styles.grid}>
          {visibleRewards.map((reward) => {
            const archived = isArchived(reward);
            const trashed = isTrashed(reward);
            const state = getRewardState(reward);
            const category = normalizeBusinessCategory(reward.category);
            const title = lang === 'HE' ? localizedRewardText(reward.titleHe, reward.titleEn) : localizedRewardText(reward.titleEn, reward.titleHe);
            const description =
              lang === 'HE'
                ? localizedRewardText(reward.descriptionHe, reward.descriptionEn)
                : localizedRewardText(reward.descriptionEn, reward.descriptionHe);
            const toggling = togglingId === reward.id;
            return (
              <Card key={reward.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <CategoryIcon category={category} label={t(`rewards.${categoryTranslationKey(category)}`)} />
                  {trashed ? (
                    <StatusBadge tone="danger">{t('rewards.stateTrashed')}</StatusBadge>
                  ) : archived ? (
                    <StatusBadge tone="neutral">{t('rewards.stateArchived')}</StatusBadge>
                  ) : (
                    <StatusBadge tone={state === 'active' ? 'success' : state === 'endingSoon' || state === 'soldOut' ? 'warning' : 'neutral'}>
                      {t(`rewards.${STATE_KEY[state]}`)}
                    </StatusBadge>
                  )}
                </div>
                <Heading level={2}>{title}</Heading>
                {description !== '' && <Text variant="body">{description}</Text>}
                <Text variant="caption">{t(`rewards.${categoryTranslationKey(reward.category)}`)}</Text>

                <div className={styles.detailRow}>
                  <Text variant="caption">{t('rewards.costPointsLabel')}</Text>
                  <Text variant="label">{reward.costPoints}</Text>
                </div>
                <div className={styles.detailRow}>
                  <Text variant="caption">{t('rewards.allocationLabel')}</Text>
                  <Text variant="label" dir="ltr">
                    {reward.stock === null ? t('rewards.allocationUnlimited') : `${reward.available ?? 0}/${reward.stock}`}
                  </Text>
                </div>
                {reward.expiresAt && (
                  <div className={styles.detailRow}>
                    <Text variant="caption">{t('rewards.expiresLabel')}</Text>
                    <Text variant="label" dir="ltr">
                      {new Date(reward.expiresAt).toLocaleDateString(lang === 'HE' ? 'he-IL' : 'en-US')}
                    </Text>
                  </div>
                )}

                {canManage && retireErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {retireErrors[reward.id]}
                  </Text>
                )}
                {canManage && toggleErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {toggleErrors[reward.id]}
                  </Text>
                )}
                {canManage && trashErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {trashErrors[reward.id]}
                  </Text>
                )}
                {canManage && restoreErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {restoreErrors[reward.id]}
                  </Text>
                )}
                {canManage && reactivateErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {reactivateErrors[reward.id]}
                  </Text>
                )}
                {canManage && deleteErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {deleteErrors[reward.id]}
                  </Text>
                )}

                {/* Disabled whenever *any* lifecycle action is in flight —
                    not just this card's, and not just this action's.
                    CAR-202's pre-commit review (B3) found that a second
                    card's confirm dialog opening while another reward's
                    mutation was in flight let the first request's completion
                    silently clear the second reward's still-unconfirmed
                    dialog; this feature adds four more actions to the same rows,
                    so every button below shares the one combined guard
                    (`lifecycleActionInFlight`) rather than reinventing a
                    pairwise one per new action. */}
                {canManage && !archived && !trashed && (
                  <div className={styles.actions}>
                    <Button
                      variant={state === 'soldOut' ? 'primary' : 'secondary'}
                      onClick={() => setFormState({ mode: 'edit', reward })}
                    >
                      {state === 'soldOut' ? t('rewards.addStockButton') : t('rewards.editButton')}
                    </Button>
                    <Button variant="secondary" disabled={lifecycleActionInFlight} onClick={() => handleToggleActive(reward)}>
                      {toggling
                        ? t(reward.isActive ? 'rewards.pausingLabel' : 'rewards.resumingLabel')
                        : t(reward.isActive ? 'rewards.pauseButton' : 'rewards.resumeButton')}
                    </Button>
                    <Button variant="secondary" disabled={lifecycleActionInFlight} onClick={() => openRetireDialog(reward)}>
                      {retiringId === reward.id ? t('rewards.retiringLabel') : t('rewards.retireButton')}
                    </Button>
                    <Button variant="secondary" disabled={lifecycleActionInFlight} onClick={() => openTrashDialog(reward)}>
                      {trashingId === reward.id ? t('rewards.trashingLabel') : t('rewards.trashButton')}
                    </Button>
                  </div>
                )}

                {canManage && archived && !trashed && (
                  <div className={styles.actions}>
                    <Button variant="primary" disabled={lifecycleActionInFlight} onClick={() => handleReactivate(reward)}>
                      {reactivatingId === reward.id ? t('rewards.reactivatingLabel') : t('rewards.reactivateButton')}
                    </Button>
                    <Button variant="secondary" disabled={lifecycleActionInFlight} onClick={() => openTrashDialog(reward)}>
                      {trashingId === reward.id ? t('rewards.trashingLabel') : t('rewards.trashButton')}
                    </Button>
                  </div>
                )}

                {canManage && trashed && (
                  <div className={styles.actions}>
                    <Button variant="primary" disabled={lifecycleActionInFlight} onClick={() => handleRestore(reward)}>
                      {restoringId === reward.id ? t('rewards.restoringLabel') : t('rewards.restoreButton')}
                    </Button>
                    <Button variant="secondary" disabled={lifecycleActionInFlight} onClick={() => setDeleteTarget(reward)}>
                      {deletingId === reward.id ? t('rewards.deletingPermanentlyLabel') : t('rewards.deletePermanentlyButton')}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <RewardForm
        open={formState !== null}
        mode={formState?.mode ?? 'create'}
        reward={formState?.mode === 'edit' ? formState.reward : null}
        defaultCategory={defaultCategory}
        onClose={() => setFormState(null)}
        onSaved={handleSaved}
      />

      <Dialog
        open={retireTarget !== null}
        onClose={() => {
          if (retireInFlight.current) return;
          setRetireTarget(null);
        }}
        title={t('rewards.retireConfirmTitle')}
        closeLabel={t('rewards.retireConfirmCloseLabel')}
      >
        {/* Gated on retireTarget, not just the status: Dialog keeps its
            children mounted while closed (native <dialog> hides them, but
            jsdom in tests does not), so an ungated 'loading' default would
            leak this text into the document before the dialog was ever
            opened. */}
        {retireTarget !== null && liveVoucherCheck.status === 'loading' && (
          <Text variant="caption">{t('rewards.retireCheckingVouchers')}</Text>
        )}
        {retireTarget !== null && liveVoucherCheck.status === 'error' && (
          <Text variant="caption" role="alert">
            {t('rewards.retireCheckErrorMessage')}
          </Text>
        )}
        {retireTarget !== null && liveVoucherCheck.status === 'ok' && (
          <Text variant="body">
            {liveVoucherCheck.count === 0
              ? t('rewards.retireConfirmBody')
              : liveVoucherCheck.count === 1
                ? t('rewards.retireLiveVoucherWarningSingular')
                : t('rewards.retireLiveVoucherWarningPlural').replace('{count}', String(liveVoucherCheck.count))}
          </Text>
        )}
        <div className={styles.actions}>
          {/* Only a confirmed, real server count unlocks this — never a guess
              and never the still-loading or failed-fetch states (CAR-115). */}
          <Button
            variant="primary"
            disabled={lifecycleActionInFlight || liveVoucherCheck.status !== 'ok'}
            onClick={handleConfirmRetire}
          >
            {t('rewards.retireConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={retiringId !== null} onClick={() => setRetireTarget(null)}>
            {t('rewards.retireConfirmCancel')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={trashTarget !== null}
        onClose={() => {
          if (trashInFlight.current) return;
          setTrashTarget(null);
        }}
        title={t('rewards.trashConfirmTitle')}
        closeLabel={t('rewards.trashConfirmCloseLabel')}
      >
        {/* Gated on trashTarget for the same reason the retire dialog above
            is — Dialog's children stay mounted while closed. */}
        {trashTarget !== null && trashLiveVoucherCheck.status === 'loading' && (
          <Text variant="caption">{t('rewards.trashCheckingVouchers')}</Text>
        )}
        {trashTarget !== null && trashLiveVoucherCheck.status === 'error' && (
          <Text variant="caption" role="alert">
            {t('rewards.trashCheckErrorMessage')}
          </Text>
        )}
        {trashTarget !== null && trashLiveVoucherCheck.status === 'ok' && (
          <Text variant="body" role={trashLiveVoucherCheck.count > 0 ? 'alert' : undefined}>
            {trashLiveVoucherCheck.count === 0
              ? t('rewards.trashConfirmBody')
              : trashLiveVoucherCheck.count === 1
                ? t('rewards.trashBlockedLiveVoucherSingular')
                : t('rewards.trashBlockedLiveVoucherPlural').replace('{count}', String(trashLiveVoucherCheck.count))}
          </Text>
        )}
        <div className={styles.actions}>
          {/* A nonzero count keeps this disabled, not just an unconfirmed
              count — the server hard-refuses a live voucher, unlike
              archiving's own warn-but-allow dialog above. */}
          <Button
            variant="primary"
            disabled={
              lifecycleActionInFlight ||
              trashLiveVoucherCheck.status !== 'ok' ||
              trashLiveVoucherCheck.count > 0
            }
            onClick={handleConfirmTrash}
          >
            {t('rewards.trashConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={trashingId !== null} onClick={() => setTrashTarget(null)}>
            {t('rewards.trashConfirmCancel')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (deleteInFlight.current) return;
          setDeleteTarget(null);
        }}
        title={t('rewards.deletePermanentlyConfirmTitle')}
        closeLabel={t('rewards.deletePermanentlyConfirmCloseLabel')}
      >
        <Text variant="body">{t('rewards.deletePermanentlyConfirmBody')}</Text>
        <div className={styles.actions}>
          <Button variant="primary" disabled={lifecycleActionInFlight} onClick={handleConfirmDelete}>
            {t('rewards.deletePermanentlyConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={deletingId !== null} onClick={() => setDeleteTarget(null)}>
            {t('rewards.deletePermanentlyConfirmCancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
