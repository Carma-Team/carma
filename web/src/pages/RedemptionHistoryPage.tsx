import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { listRewards, type Reward } from '@/lib/api/rewards';
import {
  listRedemptionHistory,
  type RedemptionHistoryEntry,
  type RedemptionHistoryStatus,
} from '@/lib/api/redemptionHistory';
import { localizedRewardText } from '@/lib/rewardState';
import { Card, Heading, Text, Button, LoadingState, ErrorState, EmptyState } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';
import styles from './RedemptionHistoryPage.module.css';

type PageStatus = 'loading' | 'ready' | 'error' | 'forbidden';
type LoadMoreStatus = 'idle' | 'loading' | 'error';
type StatusFilter = RedemptionHistoryStatus | 'all';

// USED-only by default — the same "what history means to a shop owner" the
// server itself defaults to (business_service.parse_redemption_status_filter).
const DEFAULT_STATUS_FILTER: StatusFilter = 'used';
const STATUS_FILTERS: StatusFilter[] = ['used', 'expired', 'cancelled', 'all'];

function apiStatuses(filter: StatusFilter): RedemptionHistoryStatus[] {
  return filter === 'all' ? ['used', 'expired', 'cancelled'] : [filter];
}

// A date-only `<input type="date">` value has no timezone of its own — built
// from its parts as the browser's local calendar date, then converted to an
// aware ISO string, matching `rewardState.ts::expiryDateInputToIso`'s reasoning
// for why this can't just be `new Date(dateStr)` (that reads UTC midnight,
// off by a day behind UTC). The server 400s on anything naive either way
// (`_require_aware` in services/business.py).
function dateInputToRangeStart(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

function dateInputToRangeEnd(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

const STATUS_KEY: Record<RedemptionHistoryStatus, 'statusUsed' | 'statusExpired' | 'statusCancelled'> = {
  used: 'statusUsed',
  expired: 'statusExpired',
  cancelled: 'statusCancelled',
};

const FILTER_LABEL_KEY: Record<StatusFilter, 'filterStatusUsed' | 'filterStatusExpired' | 'filterStatusCancelled' | 'filterStatusAll'> = {
  used: 'filterStatusUsed',
  expired: 'filterStatusExpired',
  cancelled: 'filterStatusCancelled',
  all: 'filterStatusAll',
};

export function RedemptionHistoryPage() {
  const { t, lang } = useTranslation();
  const [pageStatus, setPageStatus] = useState<PageStatus>('loading');
  const [entries, setEntries] = useState<RedemptionHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadMoreStatus, setLoadMoreStatus] = useState<LoadMoreStatus>('idle');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER);
  const [rewardFilter, setRewardFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [rewards, setRewards] = useState<Reward[]>([]);

  // Bumped by every fetch — the initial/filter-change load and each "load
  // more" — so a response that resolves after a newer one has already
  // started (a filter change mid-flight, or a fast double click) is dropped
  // instead of appending stale or duplicate rows onto the current list.
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listRewards().then((result) => {
      if (!cancelled && result.outcome === 'ok') setRewards(result.rewards);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function currentFilters(cursor: string | null) {
    return {
      statuses: apiStatuses(statusFilter),
      rewardId: rewardFilter || null,
      from: fromDate ? dateInputToRangeStart(fromDate) : null,
      to: toDate ? dateInputToRangeEnd(toDate) : null,
      cursor,
    };
  }

  // Shared by the filter-change effect and `retry` — both fetch a fresh
  // first page (cursor null). Every call bumps `requestIdRef`, so a response
  // from an earlier call (a filter changed again, or a retry fired while the
  // previous fetch was still in flight) is dropped rather than overwriting a
  // newer one's result. Never sets `pageStatus` to 'loading' itself — see the
  // effect below for why that has to happen in the caller instead.
  function beginFirstPageFetch() {
    const requestId = ++requestIdRef.current;
    listRedemptionHistory(currentFilters(null)).then((result) => {
      if (requestIdRef.current !== requestId) return;
      if (result.outcome === 'ok') {
        setEntries(result.redemptions);
        setNextCursor(result.nextCursor);
        setLoadMoreStatus('idle');
        setPageStatus('ready');
      } else if (result.outcome === 'forbidden') {
        setPageStatus('forbidden');
      } else {
        setPageStatus('error');
      }
    });
  }

  // Every filter starts a fresh result set — cursor reset to null and the
  // existing page discarded, never appended to, so a narrower filter can
  // never show a stale page mixed with rows the new filter wouldn't itself
  // have returned. The cleanup bumps `requestIdRef` on unmount too, so a
  // response that resolves after the page has gone away is dropped the same
  // way a superseded filter change is.
  //
  // `pageStatus` flips to 'loading' in each filter's own change handler
  // below, not here — a synchronous `setState` in an effect body is exactly
  // the cascading-render pattern `react-hooks/set-state-in-effect` flags
  // (same convention as `BusinessRequestsReviewPage`'s status filter). The
  // initial 'loading' state covers the very first run.
  useEffect(() => {
    beginFirstPageFetch();
    return () => {
      requestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, rewardFilter, fromDate, toDate]);

  function retry() {
    setPageStatus('loading');
    beginFirstPageFetch();
  }

  function handleStatusFilterChange(value: StatusFilter) {
    setPageStatus('loading');
    setStatusFilter(value);
  }

  function handleRewardFilterChange(value: string) {
    setPageStatus('loading');
    setRewardFilter(value);
  }

  function handleFromDateChange(value: string) {
    setPageStatus('loading');
    setFromDate(value);
  }

  function handleToDateChange(value: string) {
    setPageStatus('loading');
    setToDate(value);
  }

  async function loadMore() {
    if (loadMoreStatus === 'loading' || nextCursor === null) return;
    setLoadMoreStatus('loading');
    const requestId = ++requestIdRef.current;
    const result = await listRedemptionHistory(currentFilters(nextCursor));
    if (requestIdRef.current !== requestId) return;
    if (result.outcome === 'ok') {
      setEntries((prev) => [...prev, ...result.redemptions]);
      setNextCursor(result.nextCursor);
      setLoadMoreStatus('idle');
    } else {
      setLoadMoreStatus('error');
    }
  }

  function rewardTitle(reward: RedemptionHistoryEntry['reward']): string {
    return lang === 'HE' ? localizedRewardText(reward.titleHe, reward.titleEn) : localizedRewardText(reward.titleEn, reward.titleHe);
  }

  function formatSettledAt(value: string): string {
    const date = new Date(value);
    return date.toLocaleString(lang === 'HE' ? 'he-IL' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  if (pageStatus === 'loading') {
    return <LoadingState label={t('redemptionHistory.loadingLabel')} />;
  }

  if (pageStatus === 'forbidden') {
    return <ErrorState title={t('redemptionHistory.forbiddenTitle')} message={t('redemptionHistory.forbiddenMessage')} />;
  }

  if (pageStatus === 'error') {
    return (
      <ErrorState
        title={t('redemptionHistory.loadErrorTitle')}
        message={t('redemptionHistory.loadErrorMessage')}
        onRetry={retry}
        retryLabel={t('redemptionHistory.retryButton')}
      />
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <Heading level={1}>{t('redemptionHistory.title')}</Heading>
        <Text variant="body">{t('redemptionHistory.subtitle')}</Text>

        <div className={styles.filterRow}>
          <div className={inputStyles.field}>
            <label htmlFor="redemption-history-status" className={inputStyles.label}>
              {t('redemptionHistory.filterStatusLabel')}
            </label>
            <select
              id="redemption-history-status"
              className={inputStyles.input}
              value={statusFilter}
              onChange={(event) => handleStatusFilterChange(event.target.value as StatusFilter)}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(`redemptionHistory.${FILTER_LABEL_KEY[value]}`)}
                </option>
              ))}
            </select>
          </div>

          <div className={inputStyles.field}>
            <label htmlFor="redemption-history-reward" className={inputStyles.label}>
              {t('redemptionHistory.filterRewardLabel')}
            </label>
            <select
              id="redemption-history-reward"
              className={inputStyles.input}
              value={rewardFilter}
              onChange={(event) => handleRewardFilterChange(event.target.value)}
            >
              <option value="">{t('redemptionHistory.filterRewardAll')}</option>
              {rewards.map((reward) => (
                <option key={reward.id} value={reward.id}>
                  {lang === 'HE'
                    ? localizedRewardText(reward.titleHe, reward.titleEn)
                    : localizedRewardText(reward.titleEn, reward.titleHe)}
                </option>
              ))}
            </select>
          </div>

          <div className={inputStyles.field}>
            <label htmlFor="redemption-history-from" className={inputStyles.label}>
              {t('redemptionHistory.filterFromLabel')}
            </label>
            <input
              id="redemption-history-from"
              type="date"
              className={inputStyles.input}
              value={fromDate}
              onChange={(event) => handleFromDateChange(event.target.value)}
            />
          </div>

          <div className={inputStyles.field}>
            <label htmlFor="redemption-history-to" className={inputStyles.label}>
              {t('redemptionHistory.filterToLabel')}
            </label>
            <input
              id="redemption-history-to"
              type="date"
              className={inputStyles.input}
              value={toDate}
              onChange={(event) => handleToDateChange(event.target.value)}
            />
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState title={t('redemptionHistory.emptyTitle')} message={t('redemptionHistory.emptyMessage')} />
      ) : (
        <>
          <Card>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('redemptionHistory.rewardColumnLabel')}</th>
                  <th>{t('redemptionHistory.settledAtColumnLabel')}</th>
                  <th>{t('redemptionHistory.statusColumnLabel')}</th>
                  <th>{t('redemptionHistory.pointsCostColumnLabel')}</th>
                  <th>{t('redemptionHistory.memberColumnLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Text variant="body" as="span">
                        {rewardTitle(entry.reward)}
                      </Text>
                    </td>
                    <td>
                      <Text variant="caption" dir="ltr">
                        {formatSettledAt(entry.settledAt)}
                      </Text>
                    </td>
                    <td>
                      <span className={styles.statusBadge} data-status={entry.status}>
                        {t(`redemptionHistory.${STATUS_KEY[entry.status]}`)}
                      </span>
                    </td>
                    <td>
                      <Text variant="label" dir="ltr">
                        {entry.pointsCost}
                      </Text>
                    </td>
                    <td>
                      <Text variant="body" as="span">
                        {entry.consumedByName ?? t('redemptionHistory.memberUnknownLabel')}
                      </Text>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className={styles.footer}>
            {nextCursor !== null ? (
              // The same button doubles as the retry affordance on
              // `loadMoreStatus === 'error'` — `nextCursor` is untouched by a
              // failed page fetch, so clicking it again just replays the same
              // request rather than needing a separate control.
              <Button variant="secondary" disabled={loadMoreStatus === 'loading'} onClick={loadMore}>
                {loadMoreStatus === 'loading' ? t('redemptionHistory.loadingMoreLabel') : t('redemptionHistory.loadMoreButton')}
              </Button>
            ) : (
              <Text variant="caption">{t('redemptionHistory.endOfResultsLabel')}</Text>
            )}
            {loadMoreStatus === 'error' && (
              <Text variant="caption" role="alert">
                {t('redemptionHistory.loadMoreErrorMessage')}
              </Text>
            )}
          </div>
        </>
      )}
    </div>
  );
}
