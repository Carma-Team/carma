import { Calendar, Film, Fuel, Gift, Leaf, Package, ShoppingCart, Star, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { Reward } from '@/lib/api/rewards';
import { normalizeBusinessCategory, type BusinessCategory } from '@/lib/businessCategory';
import { rewardIconOption } from '@/lib/rewardIcons';
import {
  categoryTranslationKey,
  getRewardState,
  isArchived,
  isTrashed,
  localizedRewardText,
  type RewardState,
} from '@/lib/rewardState';
import { Button, Heading, Menu, MenuItem, StatusBadge, Text } from '@/components/ui';
import type { TranslationMap } from '@/i18n/types';
import styles from './RewardCard.module.css';

const STATE_KEY: Record<RewardState, keyof TranslationMap['rewards']> = {
  active: 'stateActive',
  soldOut: 'stateSoldOut',
  expired: 'stateExpired',
  inactive: 'stateInactive',
  endingSoon: 'stateEndingSoon',
};

// The small icon beside the category row — the business's taxonomy, not the
// reward's own picked icon (rewardIcons.ts), which owns the header instead.
const CATEGORY_ICON: Record<BusinessCategory, LucideIcon> = {
  fuel: Fuel,
  food: UtensilsCrossed,
  eco: Leaf,
  entertainment: Film,
  shopping: ShoppingCart,
  other: Gift,
};

type RewardCardProps = {
  reward: Reward;
  canManage: boolean;
  lifecycleActionInFlight: boolean;
  toggling: boolean;
  retiring: boolean;
  trashing: boolean;
  restoring: boolean;
  reactivating: boolean;
  deleting: boolean;
  retireError?: string;
  toggleError?: string;
  trashError?: string;
  restoreError?: string;
  reactivateError?: string;
  deleteError?: string;
  onEdit: (reward: Reward) => void;
  onToggleActive: (reward: Reward) => void;
  onOpenRetireDialog: (reward: Reward) => void;
  onOpenTrashDialog: (reward: Reward) => void;
  onReactivate: (reward: Reward) => void;
  onRestore: (reward: Reward) => void;
  onRequestDelete: (reward: Reward) => void;
};

export function RewardCard({
  reward,
  canManage,
  lifecycleActionInFlight,
  toggling,
  retiring,
  trashing,
  restoring,
  reactivating,
  deleting,
  retireError,
  toggleError,
  trashError,
  restoreError,
  reactivateError,
  deleteError,
  onEdit,
  onToggleActive,
  onOpenRetireDialog,
  onOpenTrashDialog,
  onReactivate,
  onRestore,
  onRequestDelete,
}: RewardCardProps) {
  const { t, lang } = useTranslation();
  const archived = isArchived(reward);
  const trashed = isTrashed(reward);
  const state = getRewardState(reward);
  const category = normalizeBusinessCategory(reward.category);
  const CategoryIcon = CATEGORY_ICON[category];
  const RewardIcon = rewardIconOption(reward.imageIcon).Icon;
  const title = lang === 'HE' ? localizedRewardText(reward.titleHe, reward.titleEn) : localizedRewardText(reward.titleEn, reward.titleHe);
  const description =
    lang === 'HE' ? localizedRewardText(reward.descriptionHe, reward.descriptionEn) : localizedRewardText(reward.descriptionEn, reward.descriptionHe);

  // The same desaturated header the design gives a paused card — active
  // state carries the category's own pastel tone, everything else reads as
  // dormant regardless of which category it belongs to.
  const headerMuted = archived || trashed || !reward.isActive;

  return (
    <div className={styles.card}>
      <div className={styles.header} data-category={category} data-muted={headerMuted}>
        <RewardIcon size={34} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.badge}>
          {trashed ? (
            <StatusBadge tone="danger">{t('rewards.stateTrashed')}</StatusBadge>
          ) : archived ? (
            <StatusBadge tone="neutral">{t('rewards.stateArchived')}</StatusBadge>
          ) : (
            <StatusBadge tone={state === 'active' ? 'success' : state === 'endingSoon' || state === 'soldOut' ? 'warning' : 'neutral'}>
              {t(`rewards.${STATE_KEY[state]}`)}
            </StatusBadge>
          )}
        </span>
      </div>

      <div className={styles.body}>
        {/* h3/16px, tokens.css's own "Card title" size — not h2, which is
            styled for a page section heading and reads oversized repeated
            once per card in a grid (docs/business-portal-design/CARMA
            Rewards Management.dc.html, screen 01: 15px/700). */}
        <Heading level={3}>{title}</Heading>
        {description && <Text variant="body">{description}</Text>}
        <span className={styles.categoryRow}>
          <CategoryIcon size={12} aria-hidden="true" />
          <Text variant="caption" as="span">
            {t(`rewards.${categoryTranslationKey(reward.category)}`)}
          </Text>
        </span>

        <div className={styles.metadata}>
          <div className={styles.metadataRow} data-emphasis="true">
            <Star size={14} className={styles.metadataIcon} aria-hidden="true" />
            <Text variant="label" as="span">
              {reward.costPoints}
            </Text>
            <Text variant="caption" as="span">
              {t('rewards.costPointsLabel')}
            </Text>
          </div>
          <div className={styles.metadataRow} data-warn={state === 'soldOut' ? 'true' : undefined}>
            <Package size={14} className={styles.metadataIcon} aria-hidden="true" />
            <Text variant="caption" as="span">
              {t('rewards.allocationLabel')}:
            </Text>
            <Text variant="label" as="span" dir="ltr">
              {reward.stock === null ? t('rewards.allocationUnlimited') : `${reward.available ?? 0}/${reward.stock}`}
            </Text>
          </div>
          {reward.expiresAt && (
            <div className={styles.metadataRow} data-warn={state === 'endingSoon' ? 'true' : undefined}>
              <Calendar size={14} className={styles.metadataIcon} aria-hidden="true" />
              <Text variant="caption" as="span">
                {t('rewards.expiresLabel')}:
              </Text>
              <Text variant="label" as="span" dir="ltr">
                {new Date(reward.expiresAt).toLocaleDateString(lang === 'HE' ? 'he-IL' : 'en-US')}
              </Text>
            </div>
          )}
        </div>

        <div className={styles.divider} />

        {canManage && retireError && (
          <Text variant="caption" role="alert">
            {retireError}
          </Text>
        )}
        {canManage && toggleError && (
          <Text variant="caption" role="alert">
            {toggleError}
          </Text>
        )}
        {canManage && trashError && (
          <Text variant="caption" role="alert">
            {trashError}
          </Text>
        )}
        {canManage && restoreError && (
          <Text variant="caption" role="alert">
            {restoreError}
          </Text>
        )}
        {canManage && reactivateError && (
          <Text variant="caption" role="alert">
            {reactivateError}
          </Text>
        )}
        {canManage && deleteError && (
          <Text variant="caption" role="alert">
            {deleteError}
          </Text>
        )}

        {/* Every action here is the same lifecycle call RewardsPage already
            guarded and tested (CAR-202/CAR-339) — this restructuring only
            moves secondary actions into the "..." menu the approved design
            places them in; it changes none of their handlers, disabled
            guards, or labels. */}
        {canManage && !archived && !trashed && (
          <div className={styles.actions}>
            <Button variant={state === 'soldOut' ? 'primary' : 'secondary'} onClick={() => onEdit(reward)}>
              {state === 'soldOut' ? t('rewards.addStockButton') : t('rewards.editButton')}
            </Button>
            <Menu triggerLabel={t('rewards.moreActionsLabel')}>
              <MenuItem disabled={lifecycleActionInFlight} onClick={() => onToggleActive(reward)}>
                {toggling ? t(reward.isActive ? 'rewards.pausingLabel' : 'rewards.resumingLabel') : t(reward.isActive ? 'rewards.pauseButton' : 'rewards.resumeButton')}
              </MenuItem>
              <MenuItem disabled={lifecycleActionInFlight} onClick={() => onOpenRetireDialog(reward)}>
                {retiring ? t('rewards.retiringLabel') : t('rewards.retireButton')}
              </MenuItem>
              <MenuItem disabled={lifecycleActionInFlight} onClick={() => onOpenTrashDialog(reward)}>
                {trashing ? t('rewards.trashingLabel') : t('rewards.trashButton')}
              </MenuItem>
            </Menu>
          </div>
        )}

        {canManage && archived && !trashed && (
          <div className={styles.actions}>
            <Button variant="primary" disabled={lifecycleActionInFlight} onClick={() => onReactivate(reward)}>
              {reactivating ? t('rewards.reactivatingLabel') : t('rewards.reactivateButton')}
            </Button>
            <Menu triggerLabel={t('rewards.moreActionsLabel')}>
              <MenuItem disabled={lifecycleActionInFlight} onClick={() => onOpenTrashDialog(reward)}>
                {trashing ? t('rewards.trashingLabel') : t('rewards.trashButton')}
              </MenuItem>
            </Menu>
          </div>
        )}

        {canManage && trashed && (
          <div className={styles.actions}>
            <Button variant="primary" disabled={lifecycleActionInFlight} onClick={() => onRestore(reward)}>
              {restoring ? t('rewards.restoringLabel') : t('rewards.restoreButton')}
            </Button>
            <Menu triggerLabel={t('rewards.moreActionsLabel')}>
              <MenuItem disabled={lifecycleActionInFlight} onClick={() => onRequestDelete(reward)}>
                {deleting ? t('rewards.deletingPermanentlyLabel') : t('rewards.deletePermanentlyButton')}
              </MenuItem>
            </Menu>
          </div>
        )}
      </div>
    </div>
  );
}
