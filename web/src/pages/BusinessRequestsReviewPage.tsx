import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  approveBusinessRequest,
  listBusinessRequests,
  rejectBusinessRequest,
  type BusinessRequestAdmin,
  type BusinessRequestActionResult,
  type BusinessRequestStatus,
} from '@/lib/api/businessRequests';
import { Card, Heading, Text, Button, Dialog, LoadingState, ErrorState, EmptyState } from '@/components/ui';
import inputStyles from '@/components/ui/Input.module.css';
import styles from './BusinessRequestsReviewPage.module.css';

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterValue = BusinessRequestStatus | 'all';

// Pending-first by default (CAR-255's "easy to review first") is just this
// initial filter value — every other status stays one select away, and the
// server (`services/business_join_requests.py::parse_status_filter`) is what
// actually understands 'pending'/'approved'/'rejected'; 'all' is a client
// affordance that simply omits the query param.
const DEFAULT_FILTER: FilterValue = 'pending';
const FILTERS: FilterValue[] = ['pending', 'approved', 'rejected', 'all'];

export function BusinessRequestsReviewPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER);
  const [requests, setRequests] = useState<BusinessRequestAdmin[]>([]);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [rejectTarget, setRejectTarget] = useState<BusinessRequestAdmin | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectNoteError, setRejectNoteError] = useState<string | null>(null);
  // One mutation at a time, same convention as PermissionsPage's
  // mutationInFlight — every other action button is disabled while it holds,
  // and only the row actually in flight shows a busy label, so a duplicate
  // click on the same row's own button can never fire a second request.
  const mutationInFlight = useRef(false);

  function apiFilter(value: FilterValue): BusinessRequestStatus | undefined {
    return value === 'all' ? undefined : value;
  }

  function applyListResult(result: Awaited<ReturnType<typeof listBusinessRequests>>) {
    if (result.outcome === 'ok') {
      setRequests(result.requests);
      setStatus('ready');
    } else if (result.outcome === 'forbidden') {
      setStatus('forbidden');
    } else {
      setStatus('error');
    }
  }

  // `filter`'s own change handler below sets 'loading' before this effect
  // ever re-runs — setting it synchronously in the effect body itself is
  // exactly the cascading-render pattern react-hooks/set-state-in-effect
  // flags, and the initial 'loading' state covers the very first run.
  useEffect(() => {
    let cancelled = false;
    listBusinessRequests(apiFilter(filter)).then((result) => {
      if (!cancelled) applyListResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  function retry() {
    setStatus('loading');
    listBusinessRequests(apiFilter(filter)).then(applyListResult);
  }

  // Re-pulls the current filter's list in the background after a decision —
  // the returned row is applied immediately below, but only a refetch can
  // tell whether the current filter should keep showing it at all (e.g. an
  // approved request dropping out of the 'pending' view), and it is also how
  // a conflict (someone else decided this request first) or a 404 (the row
  // is gone) gets reconciled with server truth. Swallows a failed refetch
  // quietly — the decision the admin just made must not be wiped by an
  // unrelated network blip; the next explicit retry surfaces that.
  async function reconcile() {
    const result = await listBusinessRequests(apiFilter(filter));
    if (result.outcome === 'ok') setRequests(result.requests);
  }

  function clearRowError(id: string) {
    setRowErrors((prev) => {
      if (!(id in prev)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  }

  function actionErrorMessage(result: Extract<BusinessRequestActionResult, { outcome: string }>): string {
    switch (result.outcome) {
      case 'conflict':
        // Server-provided message (CAR-77's structured 409 body) — this is
        // the one place the UI is told *why* in the admin's own words,
        // rather than inventing a generic one.
        return result.message;
      case 'forbidden':
        return t('businessRequests.forbiddenActionMessage');
      case 'not_found':
        return t('businessRequests.notFoundMessage');
      case 'network_error':
        return t('businessRequests.networkErrorMessage');
      default:
        return t('businessRequests.actionErrorMessage');
    }
  }

  async function handleApprove(request: BusinessRequestAdmin) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setMutatingId(request.id);
    clearRowError(request.id);

    const result = await approveBusinessRequest(request.id);

    if (result.outcome === 'ok') {
      setRequests((prev) => prev.map((r) => (r.id === request.id ? result.request : r)));
      // Lock stays held through this reconcile too — releasing it right after
      // the mutation resolves would let a filter change race the still-open
      // GET below and land its response over the newly-selected filter's.
      await reconcile();
      mutationInFlight.current = false;
      setMutatingId(null);
      return;
    }
    setRowErrors((prev) => ({ ...prev, [request.id]: actionErrorMessage(result) }));
    if (result.outcome === 'conflict' || result.outcome === 'not_found') await reconcile();
    mutationInFlight.current = false;
    setMutatingId(null);
  }

  function openReject(request: BusinessRequestAdmin) {
    setRejectTarget(request);
    setRejectNote('');
    setRejectNoteError(null);
  }

  function closeReject() {
    if (mutationInFlight.current) return;
    setRejectTarget(null);
  }

  async function confirmReject() {
    if (!rejectTarget || mutationInFlight.current) return;
    const note = rejectNote.trim();
    if (note.length === 0) {
      setRejectNoteError(t('businessRequests.reviewerNoteRequiredError'));
      return;
    }

    const target = rejectTarget;
    mutationInFlight.current = true;
    setMutatingId(target.id);
    clearRowError(target.id);

    const result = await rejectBusinessRequest(target.id, note);
    setRejectTarget(null);

    if (result.outcome === 'ok') {
      setRequests((prev) => prev.map((r) => (r.id === target.id ? result.request : r)));
      // Lock stays held through this reconcile too — releasing it right after
      // the mutation resolves would let a filter change race the still-open
      // GET below and land its response over the newly-selected filter's.
      await reconcile();
      mutationInFlight.current = false;
      setMutatingId(null);
      return;
    }
    setRowErrors((prev) => ({ ...prev, [target.id]: actionErrorMessage(result) }));
    if (result.outcome === 'conflict' || result.outcome === 'not_found') await reconcile();
    mutationInFlight.current = false;
    setMutatingId(null);
  }

  // Every pending row otherwise shares the same visible button text
  // ("Approve"/"Reject") — naming the business closes the same
  // screen-reader ambiguity gap PermissionsPage's revoke button closes.
  function approveAriaLabel(request: BusinessRequestAdmin): string {
    return t('businessRequests.approveButtonAriaLabel').replace('{name}', request.name);
  }
  function rejectAriaLabel(request: BusinessRequestAdmin): string {
    return t('businessRequests.rejectButtonAriaLabel').replace('{name}', request.name);
  }

  if (status === 'loading') {
    return <LoadingState label={t('businessRequests.loadingLabel')} />;
  }

  if (status === 'forbidden') {
    return <ErrorState title={t('businessRequests.forbiddenTitle')} message={t('businessRequests.forbiddenMessage')} />;
  }

  if (status === 'error') {
    return (
      <ErrorState
        title={t('businessRequests.loadErrorTitle')}
        message={t('businessRequests.loadErrorMessage')}
        onRetry={retry}
        retryLabel={t('businessRequests.retryButton')}
      />
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <Heading level={1}>{t('businessRequests.title')}</Heading>
        <Text variant="body">{t('businessRequests.subtitle')}</Text>
        <div className={styles.filterRow}>
          <label htmlFor="business-requests-filter" className={styles.filterLabel}>
            {t('businessRequests.filterLabel')}
          </label>
          <select
            id="business-requests-filter"
            className={inputStyles.input}
            value={filter}
            // Disabled while a mutation is in flight: `handleApprove`/
            // `confirmReject` close over this render's `filter` for their
            // post-decision `reconcile()` call, so a filter change mid-flight
            // would let that stale closure refetch the *old* filter and
            // silently overwrite whatever the newly-selected filter had
            // fetched — leaving the list showing something other than what
            // the select control says it's showing.
            disabled={mutatingId !== null}
            onChange={(event) => {
              setStatus('loading');
              setFilter(event.target.value as FilterValue);
            }}
          >
            {FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`businessRequests.filter${filterKey(value)}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {requests.length === 0 ? (
        <EmptyState title={t('businessRequests.emptyTitle')} message={t('businessRequests.emptyMessage')} />
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('businessRequests.businessColumnLabel')}</th>
                <th>{t('businessRequests.contactColumnLabel')}</th>
                <th>{t('businessRequests.registrationColumnLabel')}</th>
                <th>{t('businessRequests.submittedColumnLabel')}</th>
                <th>{t('businessRequests.statusColumnLabel')}</th>
                <th>{t('businessRequests.actionsColumnLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const busy = mutatingId === request.id;
                return (
                  <tr key={request.id}>
                    <td>
                      <div className={styles.businessCell}>
                        <Text variant="label" as="span">
                          {request.name}
                        </Text>
                        {request.nameHe && <Text variant="caption">{request.nameHe}</Text>}
                        <Text variant="caption">{t(`businessRequests.category${categoryKey(request.category)}`)}</Text>
                        {request.address && <Text variant="caption">{request.address}</Text>}
                      </div>
                    </td>
                    <td>
                      <Text variant="body" as="span">
                        {request.contactPerson}
                      </Text>
                      <Text variant="caption" dir="ltr">
                        {request.phone}
                      </Text>
                    </td>
                    <td>
                      <Text variant="body" dir="ltr">
                        {request.registrationNumber}
                      </Text>
                    </td>
                    <td>
                      <Text variant="caption">{formatDate(request.createdAt)}</Text>
                    </td>
                    <td>
                      <span className={styles.statusBadge} data-status={request.status}>
                        {t(`businessRequests.status${statusKey(request.status)}`)}
                      </span>
                      {request.status !== 'pending' && request.reviewerNote && (
                        <Text variant="caption">
                          {t('businessRequests.reviewerNoteLabel')}: {request.reviewerNote}
                        </Text>
                      )}
                      {request.status !== 'pending' && request.reviewedAt && (
                        <Text variant="caption">
                          {t('businessRequests.reviewedAtLabel')}: {formatDate(request.reviewedAt)}
                        </Text>
                      )}
                    </td>
                    <td>
                      {request.status === 'pending' && (
                        <div className={styles.actions}>
                          <Button
                            variant="primary"
                            aria-label={approveAriaLabel(request)}
                            disabled={mutatingId !== null}
                            onClick={() => handleApprove(request)}
                          >
                            {busy ? t('businessRequests.approvingLabel') : t('businessRequests.approveButton')}
                          </Button>
                          <Button
                            variant="danger"
                            aria-label={rejectAriaLabel(request)}
                            disabled={mutatingId !== null}
                            onClick={() => openReject(request)}
                          >
                            {t('businessRequests.rejectButton')}
                          </Button>
                        </div>
                      )}
                      {rowErrors[request.id] && (
                        <Text variant="caption" role="alert">
                          {rowErrors[request.id]}
                        </Text>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={rejectTarget !== null}
        onClose={closeReject}
        title={t('businessRequests.rejectModalTitle')}
        closeLabel={t('businessRequests.rejectModalCloseLabel')}
      >
        <div className={inputStyles.field}>
          <label htmlFor="reject-reviewer-note" className={inputStyles.label}>
            {t('businessRequests.reviewerNoteLabel')}
          </label>
          <textarea
            id="reject-reviewer-note"
            className={styles.textarea}
            maxLength={500}
            autoFocus
            aria-invalid={Boolean(rejectNoteError)}
            aria-describedby={rejectNoteError ? 'reject-reviewer-note-error' : undefined}
            value={rejectNote}
            onChange={(event) => {
              setRejectNote(event.target.value);
              if (rejectNoteError) setRejectNoteError(null);
            }}
          />
          {rejectNoteError && (
            <span id="reject-reviewer-note-error" role="alert" className={inputStyles.error}>
              {rejectNoteError}
            </span>
          )}
        </div>
        <div className={styles.dialogActions}>
          <Button
            variant="danger"
            aria-label={rejectTarget ? rejectAriaLabel(rejectTarget) : undefined}
            disabled={mutatingId !== null}
            onClick={confirmReject}
          >
            {rejectTarget && mutatingId === rejectTarget.id
              ? t('businessRequests.rejectingLabel')
              : t('businessRequests.rejectConfirmButton')}
          </Button>
          <Button variant="secondary" disabled={mutatingId !== null} onClick={closeReject}>
            {t('businessRequests.rejectCancelButton')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function filterKey(value: FilterValue): 'Pending' | 'Approved' | 'Rejected' | 'All' {
  if (value === 'pending') return 'Pending';
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  return 'All';
}

function statusKey(status: BusinessRequestStatus): 'Pending' | 'Approved' | 'Rejected' {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

function categoryKey(category: string): 'Fuel' | 'Food' | 'Eco' | 'Entertainment' | 'Shopping' | 'Other' {
  switch (category) {
    case 'fuel':
      return 'Fuel';
    case 'food':
      return 'Food';
    case 'eco':
      return 'Eco';
    case 'entertainment':
      return 'Entertainment';
    case 'shopping':
      return 'Shopping';
    default:
      return 'Other';
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
