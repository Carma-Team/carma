import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { hasBusinessRole } from '@/lib/auth/businessRole';
import {
  getLiveVoucherCount,
  listRewards,
  retireReward,
  setRewardActive,
  type Reward,
} from '@/lib/api/rewards';
import { BUSINESS_CATEGORIES, isBusinessCategory, normalizeBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import {
  categoryTranslationKey,
  getRewardState,
  isArchived,
  localizedRewardText,
  matchesTab,
  type RewardState,
  type RewardTab,
} from '@/lib/rewardState';
import { RewardForm } from '@/components/business/RewardForm';
import { Card, Heading, Text, Button, Dialog, ErrorState, EmptyState, Input, StatusBadge, CountBadge, Skeleton } from '@/components/ui';
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
};

const TABS: RewardTab[] = ['all', 'active', 'paused', 'ended', 'archived'];

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
    if (togglingId !== null) return;
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
    if (!retireTarget || retireInFlight.current || liveVoucherCheck.status !== 'ok') return;
    const target = retireTarget;
    retireInFlight.current = true;
    setRetiringId(target.id);
    const result = await retireReward(target.id);
    retireInFlight.current = false;
    setRetiringId(null);
    setRetireTarget(null);

    if (result.outcome === 'ok') {
      setRewards((prev) => prev.filter((r) => r.id !== target.id));
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

  const nonArchived = useMemo(() => rewards.filter((r) => !isArchived(r)), [rewards]);
  const activeCount = useMemo(() => rewards.filter((r) => matchesTab(r, 'active')).length, [rewards]);

  const tabCounts = useMemo(() => {
    const counts: Record<RewardTab, number> = { all: 0, active: 0, paused: 0, ended: 0, archived: 0 };
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

      {!noRewardsAtAll && (
        <div className={styles.toolbar}>
          {canManage && (
            <div className={styles.tabs}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={styles.tab}
                  data-active={activeTab === tab}
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
            title={activeTab === 'archived' ? t('rewards.filterArchived') : t('rewards.noResultsTitle')}
            message={activeTab === 'archived' ? t('rewards.archivedEmptyMessage') : t('rewards.noResultsMessage')}
          />
        )
      ) : (
        <div className={styles.grid}>
          {visibleRewards.map((reward) => {
            const archived = isArchived(reward);
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
                  <span className={styles.categoryIcon} data-category={category} aria-hidden="true">
                    {t(`rewards.${categoryTranslationKey(category)}`).charAt(0)}
                  </span>
                  {archived ? (
                    <StatusBadge tone="neutral">{t('rewards.stateArchived')}</StatusBadge>
                  ) : (
                    <StatusBadge tone={state === 'active' ? 'success' : state === 'endingSoon' || state === 'soldOut' ? 'warning' : 'neutral'}>
                      {t(`rewards.${STATE_KEY[state]}`)}
                    </StatusBadge>
                  )}
                </div>
                <Heading level={2}>{title}</Heading>
                <Text variant="body">{description}</Text>
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

                {canManage && !archived && (
                  <div className={styles.actions}>
                    <Button variant="secondary" onClick={() => setFormState({ mode: 'edit', reward })}>
                      {state === 'soldOut' ? t('rewards.addStockButton') : t('rewards.editButton')}
                    </Button>
                    {/* Any in-flight toggle disables every card's button, not
                        just this one's — the same interleaving guard as the
                        archive button just below (CAR-202 review, B3). */}
                    <Button variant="secondary" disabled={togglingId !== null} onClick={() => handleToggleActive(reward)}>
                      {toggling
                        ? t(reward.isActive ? 'rewards.pausingLabel' : 'rewards.resumingLabel')
                        : t(reward.isActive ? 'rewards.pauseButton' : 'rewards.resumeButton')}
                    </Button>
                    {/* Disabled whenever *any* archive is in flight, not just
                        this card's — CAR-202's pre-commit review (B3) found that
                        allowing a second card's confirm dialog to open while
                        another reward's DELETE was in flight let the first
                        request's completion silently clear the second reward's
                        still-unconfirmed dialog. One in-flight archive at a
                        time removes the interleaving entirely. */}
                    <Button variant="secondary" disabled={retiringId !== null} onClick={() => openRetireDialog(reward)}>
                      {retiringId === reward.id ? t('rewards.retiringLabel') : t('rewards.retireButton')}
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
        {liveVoucherCheck.status === 'loading' && <Text variant="caption">{t('rewards.retireCheckingVouchers')}</Text>}
        {liveVoucherCheck.status === 'error' && (
          <Text variant="caption" role="alert">
            {t('rewards.retireCheckErrorMessage')}
          </Text>
        )}
        {liveVoucherCheck.status === 'ok' && (
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
            disabled={retiringId !== null || liveVoucherCheck.status !== 'ok'}
            onClick={handleConfirmRetire}
          >
            {t('rewards.retireConfirmYes')}
          </Button>
          <Button variant="secondary" disabled={retiringId !== null} onClick={() => setRetireTarget(null)}>
            {t('rewards.retireConfirmCancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
