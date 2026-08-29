import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { listRewards, retireReward, type Reward } from '@/lib/api/rewards';
import { BUSINESS_CATEGORIES, isBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import { categoryTranslationKey, getRewardState, isArchived, localizedRewardText, type RewardState } from '@/lib/rewardState';
import { RewardForm } from '@/components/business/RewardForm';
import { Card, Heading, Text, Button, Dialog, LoadingState, ErrorState, EmptyState } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RewardsPage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';

const STATE_KEY: Record<RewardState, keyof TranslationMap['rewards']> = {
  active: 'stateActive',
  soldOut: 'stateSoldOut',
  expired: 'stateExpired',
  inactive: 'stateInactive',
};

export function RewardsPage() {
  const { t, lang } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [formState, setFormState] = useState<{ mode: 'create' } | { mode: 'edit'; reward: Reward } | null>(null);
  const [retireTarget, setRetireTarget] = useState<Reward | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [retireErrors, setRetireErrors] = useState<Record<string, string>>({});
  // Guards a second DELETE from firing before the confirm dialog's buttons
  // re-render disabled — same convention as RedemptionPage's redeemInFlight.
  const retireInFlight = useRef(false);

  const defaultCategory = useMemo<BusinessCategory>(() => {
    const category = user?.businessCategory?.toLowerCase() ?? '';
    return isBusinessCategory(category) ? category : BUSINESS_CATEGORIES[0];
  }, [user]);

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

  // Archived rewards stay in the server's OWNER/MANAGER listing forever
  // (nothing is deleted — see services/business.py::archive_reward), but
  // this ticket builds no restore/archive-history view, so a retired reward
  // must not resurface as a manageable card just because the page reloaded.
  const visibleRewards = rewards.filter((reward) => !isArchived(reward));

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

  async function handleConfirmRetire() {
    if (!retireTarget || retireInFlight.current) return;
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

  if (status === 'loading') {
    return <LoadingState label={t('rewards.loadingLabel')} />;
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

  return (
    <div>
      <div className={styles.header}>
        <div>
          <Heading level={1}>{t('rewards.title')}</Heading>
          <Text variant="body">{t('rewards.subtitle')}</Text>
        </div>
        <Button variant="primary" onClick={() => setFormState({ mode: 'create' })}>
          {t('rewards.createButton')}
        </Button>
      </div>

      {visibleRewards.length === 0 ? (
        <EmptyState title={t('rewards.emptyTitle')} message={t('rewards.emptyMessage')} />
      ) : (
        <div className={styles.grid}>
          {visibleRewards.map((reward) => {
            const state = getRewardState(reward);
            const title = lang === 'HE' ? localizedRewardText(reward.titleHe, reward.titleEn) : localizedRewardText(reward.titleEn, reward.titleHe);
            const description =
              lang === 'HE'
                ? localizedRewardText(reward.descriptionHe, reward.descriptionEn)
                : localizedRewardText(reward.descriptionEn, reward.descriptionHe);
            return (
              <Card key={reward.id} className={styles.card}>
                <span className={styles.stateBadge} data-state={state}>
                  {t(`rewards.${STATE_KEY[state]}`)}
                </span>
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

                {retireErrors[reward.id] && (
                  <Text variant="caption" role="alert">
                    {retireErrors[reward.id]}
                  </Text>
                )}

                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => setFormState({ mode: 'edit', reward })}>
                    {t('rewards.editButton')}
                  </Button>
                  {/* Disabled whenever *any* retirement is in flight, not just
                      this card's — CAR-202's pre-commit review (B3) found that
                      allowing a second card's confirm dialog to open while
                      another reward's DELETE was in flight let the first
                      request's completion silently clear the second reward's
                      still-unconfirmed dialog. One in-flight retirement at a
                      time removes the interleaving entirely. */}
                  <Button variant="danger" disabled={retiringId !== null} onClick={() => setRetireTarget(reward)}>
                    {retiringId === reward.id ? t('rewards.retiringLabel') : t('rewards.retireButton')}
                  </Button>
                </div>
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
        <Text variant="body">{t('rewards.retireConfirmBody')}</Text>
        <div className={styles.actions}>
          <Button variant="danger" disabled={retiringId !== null} onClick={handleConfirmRetire}>
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
