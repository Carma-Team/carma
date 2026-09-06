/**
 * @fileoverview Offline-first queue for persisting completed trips — SyncManager
 * @module services/sync/SyncManager
 *
 * @description
 * Manages a FIFO queue in AsyncStorage. When the API fails (network down / 5xx),
 * the trip is enqueued. On the next launch or foreground return, `flushQueue`
 * attempts to send all items in order — halting on the first one it cannot send,
 * so a dead server is not hammered once per queued trip.
 *
 * @remarks
 * - Idempotency: each trip carries a `localTripId`; the server must store a
 *   UNIQUE idempotency_key so retries after timeout are safe.
 * - Double-enqueue guard: if `localTripId` is already in the queue it is not added again.
 * - A failed upload never deletes a trip. Only age does, and then it is abandoned
 *   rather than deleted — the row survives on the device. See docs/trip-sync-queue.md.
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

// How long an unsent trip may live in the queue, measured from `queuedAt`. Age rather
// than attempt count, because a counter cannot tell a long outage from a trip the server
// will never accept, and counting attempts is what once deleted real trips (CAR-138).
// 30 days is our reward cycle. No telematics vendor publishes a local-queue TTL, so this
// is our number and not an industry one.
export const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Consecutive failures after which the head item stops holding up the queue behind it.
// High enough that a short outage never triggers a skip, low enough that a trip the server
// keeps refusing stops blocking within one session. A 429 does not count — see `failures`.
export const STUCK_AFTER = 3;

// ─── Module-level flush mutex ─────────────────────────────────────────────────
// Prevents concurrent flushes if AppState fires multiple 'active' events quickly.

let isFlushing = false;

// ─── Retry state helpers ──────────────────────────────────────────────────────

// Items queued by a build that predates the two-counter fields read back without them.
// Treat that as a clean slate rather than as an exhausted budget — a trip already
// waiting on a driver's phone must not be deleted by the upgrade meant to save it.
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

  // AppContext wires this to mark the local row as given up on. The trip is not deleted:
  // it leaves the queue and stays in history flagged as never sent.
  onTripAbandoned: undefined as ((localId: string) => void) | undefined,

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
      nextAttemptAt: null,
    });

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    console.log(`[SyncManager] Queued trip ${payload.localTripId} (queue length: ${items.length})`);
  },

  // ─── flushQueue ────────────────────────────────────────────────────────────
  // Sequential FIFO flush. Halts on the first item that fails or is still backing off,
  // to avoid hammering a dead server and to preserve battery. The one exception is an
  // item that is already stuck: see STUCK_AFTER.
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

        // The only thing that takes a trip out of the queue unsent. Checked ahead of the
        // backoff gate so an aged-out trip is released rather than waiting out a retry it
        // is no longer entitled to. Abandoned, not deleted — the row stays in history.
        if (now - Date.parse(item.queuedAt) >= MAX_QUEUE_AGE_MS) {
          console.warn(`[SyncManager] Abandoning ${item.id} — queued since ${item.queuedAt}`);
          this.onTripAbandoned?.(item.id);
          continue;
        }

        // A stuck item is stepped over instead of halting the pass, so one trip the server
        // will not take cannot block every trip behind it. The evidence that separates a
        // broken trip from a broken network is whether those later items then succeed — if
        // the network is down they fail too, and the whole skip costs one extra request.
        const isStuck = item.failures >= STUCK_AFTER;

        // Still backing off. Halt rather than skip ahead: a later trip jumping the queue
        // gains nothing and breaks the FIFO order the rest of this method preserves.
        if (item.nextAttemptAt && now < Date.parse(item.nextAttemptAt)) {
          remaining.push(item);
          if (isStuck) continue;
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

          // Network error or transient server error (0, 5xx, 408, 429) — back off and, unless
          // this item is already stuck, halt with every later item untouched. Nothing here
          // deletes a trip: the driver completed it, and none of these answers say otherwise.
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
            // the retry without ever counting towards STUCK_AFTER.
            failures: isRateLimited ? item.failures : item.failures + 1,
            backoffStep,
            nextAttemptAt: new Date(now + waitMs).toISOString(),
          });
          if (isStuck) continue;
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
