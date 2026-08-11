/**
 * @fileoverview Offline-first queue for persisting completed trips — SyncManager
 * @module services/sync/SyncManager
 *
 * @description
 * Manages a FIFO queue in AsyncStorage. When the API fails (network down / 5xx),
 * the trip is enqueued. On the next launch or foreground return, `flushQueue`
 * attempts to send all items in order — stopping completely on the first network
 * error to avoid wasting resources.
 *
 * @remarks
 * - Idempotency: each trip carries a `localTripId`; the server must store a
 *   UNIQUE idempotency_key so retries after timeout are safe.
 * - Double-enqueue guard: if `localTripId` is already in the queue it is not added again.
 * - A transient failure never deletes a trip — it only delays the next attempt.
 *   Retention policy and the value of MAX_FAILURES_BEFORE_DROP are open questions:
 *   see docs/trip-sync-queue.md.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip } from '@/types';
import { tripsApi } from '@/services/api/trips.api';
import { ApiError } from '@/services/api/client';
import type { ValidTripPayload, SyncQueueItem } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUEUE_KEY = 'carma_unsynced_trips';

// 4xx client errors (except 408 Request Timeout) — retrying will never help
const PERMANENT_FAILURE_STATUSES = new Set([400, 401, 403, 422]);

const RATE_LIMITED = 429;

// How long to wait before the next attempt, by backoff step. The last entry is the
// ceiling — a queue that cannot drain settles into hourly retries instead of trying
// on every single foreground return, which is what used to cost battery.
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

// PLACEHOLDER — not a calibrated number, and deliberately far beyond any plausible
// outage. It exists so local storage has *some* bound while the real retention policy
// is decided; nothing in the project documents one today. See docs/trip-sync-queue.md.
export const MAX_FAILURES_BEFORE_DROP = 50;

// ─── Module-level flush mutex ─────────────────────────────────────────────────
// Prevents concurrent flushes if AppState fires multiple 'active' events quickly.

let isFlushing = false;

// ─── Retry state helpers ──────────────────────────────────────────────────────

// Items queued by a build that predates the two-counter fields read back without them.
// Treat that as a clean slate rather than as an exhausted budget — a trip already
// waiting on someone's phone must not be deleted by the upgrade that was meant to save it.
function withRetryState(item: SyncQueueItem): SyncQueueItem {
  return {
    ...item,
    failures: item.failures ?? 0,
    backoffStep: item.backoffStep ?? 0,
    nextAttemptAt: item.nextAttemptAt ?? null,
  };
}

function backoffMsFor(step: number): number {
  return BACKOFF_MS[Math.min(step, BACKOFF_MS.length) - 1];
}

// ─── SyncManager (exported singleton) ────────────────────────────────────────

export const SyncManager = {
  // AppContext wires this to update recentTrips with the server-assigned ID
  onTripSynced: undefined as ((localId: string, serverTrip: Trip) => void) | undefined,

  // ─── enqueue ───────────────────────────────────────────────────────────────
  // Appends a trip to the persistent queue. Idempotent: duplicate localTripId is ignored.
  async enqueue(payload: ValidTripPayload): Promise<void> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const items: SyncQueueItem[] = raw ? JSON.parse(raw) : [];

    if (items.some(i => i.id === payload.localTripId)) {
      console.log(`[SyncManager] Trip ${payload.localTripId} already in queue — skipping`);
      return;
    }

    items.push({
      id: payload.localTripId,
      payload,
      queuedAt: new Date(Date.now()).toISOString(),
      failures: 0,
      backoffStep: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
    });

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    console.log(`[SyncManager] Queued trip ${payload.localTripId} (queue length: ${items.length})`);
  },

  // ─── flushQueue ────────────────────────────────────────────────────────────
  // Sequential FIFO flush. Halts on the first item that fails or is still backing off,
  // to avoid hammering a dead server and to preserve battery.
  async flushQueue(): Promise<void> {
    if (isFlushing) return;
    isFlushing = true;

    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      if (!raw) return;

      const items: SyncQueueItem[] = JSON.parse(raw);
      if (items.length === 0) return;

      console.log(`[SyncManager] Flushing ${items.length} queued trip(s)...`);

      const remaining: SyncQueueItem[] = [];
      let haltedAt = -1;

      for (let i = 0; i < items.length; i++) {
        const item = withRetryState(items[i]);
        const now = Date.now();

        // The only count that deletes anything. A trip reaches this having failed to
        // upload MAX_FAILURES_BEFORE_DROP times for reasons the server called permanent
        // on none of them — an outcome we have no policy for yet.
        if (item.failures >= MAX_FAILURES_BEFORE_DROP) {
          console.warn(`[SyncManager] Dropping ${item.id} — ${item.failures} failed uploads`);
          continue;
        }

        // Still backing off. Halt rather than skip ahead: a later trip jumping the queue
        // gains nothing and breaks the FIFO order the rest of this method preserves.
        if (item.nextAttemptAt && now < Date.parse(item.nextAttemptAt)) {
          remaining.push(item);
          haltedAt = i;
          break;
        }

        try {
          const serverTrip = await tripsApi.save(item.payload);
          this.onTripSynced?.(item.id, serverTrip);
          console.log(`[SyncManager] Synced ${item.id} → server ID ${serverTrip.id}`);
          // Successful — do NOT push to remaining (item removed from queue)

        } catch (error: unknown) {
          const status = error instanceof ApiError ? error.status : 0;

          // 409 Conflict: server already stored this trip (idempotency match) — treat as success
          if (status === 409) {
            console.log(`[SyncManager] ${item.id} already on server (409) — removing from queue`);
            continue;
          }

          // Client errors (400, 401, 403, 422): retrying is pointless — drop
          if (PERMANENT_FAILURE_STATUSES.has(status)) {
            console.warn(`[SyncManager] Dropping ${item.id} — permanent client error (${status})`);
            continue;
          }

          // Network error or transient server error (0, 5xx, 408, 429) — HALT.
          // Back off and preserve all subsequent items untouched. Nothing here deletes
          // a trip: the driver completed it, and none of these answers say otherwise.
          const isRateLimited = status === RATE_LIMITED;
          const retryAfterSeconds =
            error instanceof ApiError ? error.retryAfterSeconds : undefined;

          const backoffStep = item.backoffStep + 1;
          // On a 429 the server named the wait — honour it over our own schedule, and
          // fall back to the schedule if this particular response omitted the header.
          const waitMs =
            isRateLimited && retryAfterSeconds !== undefined
              ? retryAfterSeconds * 1000
              : backoffMsFor(backoffStep);

          remaining.push({
            ...item,
            // A 429 is the server rationing capacity shared with every other driver
            // behind the same carrier NAT. It is not this trip's failure, so it delays
            // the retry without ever bringing the trip closer to being deleted.
            failures: isRateLimited ? item.failures : item.failures + 1,
            backoffStep,
            lastAttemptAt: new Date(now).toISOString(),
            nextAttemptAt: new Date(now + waitMs).toISOString(),
          });
          haltedAt = i;
          break;
        }
      }

      // Preserve all items that were never attempted (after the halt point)
      if (haltedAt >= 0) {
        remaining.push(...items.slice(haltedAt + 1));
      }

      // Re-read AsyncStorage to pick up items enqueued concurrently during this flush.
      // Without this, the write-back would silently discard any trip that was enqueued
      // while a slow tripsApi.save() was in flight (D-SYNC-1 race condition).
      const originalIds = new Set(items.map(i => i.id));
      const freshRaw = await AsyncStorage.getItem(QUEUE_KEY);
      const freshItems: SyncQueueItem[] = freshRaw ? JSON.parse(freshRaw) : [];
      const addedDuringFlush = freshItems.filter(i => !originalIds.has(i.id));

      const finalQueue = [...remaining, ...addedDuringFlush];
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(finalQueue));
      console.log(`[SyncManager] Flush complete — ${finalQueue.length} item(s) remaining`);

    } finally {
      isFlushing = false;
    }
  },

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async getQueueLength(): Promise<number> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;
    return (JSON.parse(raw) as SyncQueueItem[]).length;
  },

  async clearQueue(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  },
};
