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
 * - MAX_ATTEMPTS=5: after five failures the item is dropped and logged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip } from '@/types';
import { tripsApi } from '@/services/api/trips.api';
import { ApiError } from '@/services/api/client';
import type { ValidTripPayload, SyncQueueItem } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUEUE_KEY = 'carma_unsynced_trips';
const MAX_ATTEMPTS = 5;

// 4xx client errors (except 408 Request Timeout) — retrying will never help
const PERMANENT_FAILURE_STATUSES = new Set([400, 401, 403, 422]);

// ─── Module-level flush mutex ─────────────────────────────────────────────────
// Prevents concurrent flushes if AppState fires multiple 'active' events quickly.

let isFlushing = false;

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
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastAttemptAt: null,
    });

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    console.log(`[SyncManager] Queued trip ${payload.localTripId} (queue length: ${items.length})`);
  },

  // ─── flushQueue ────────────────────────────────────────────────────────────
  // Sequential FIFO flush. Halts immediately on the first network / 5xx error
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
        const item = items[i];

        // Drop permanently failed items to prevent queue bloat
        if (item.attempts >= MAX_ATTEMPTS) {
          console.warn(`[SyncManager] Dropping ${item.id} — exceeded ${MAX_ATTEMPTS} attempts`);
          continue;
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

          // Network error or transient server error (0, 5xx, 408) — HALT
          // Increment attempts for the failed item, preserve all subsequent items untouched
          remaining.push({
            ...item,
            attempts: item.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
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
