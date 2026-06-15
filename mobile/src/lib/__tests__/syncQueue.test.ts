import { SyncManager } from '@/services/sync/SyncManager';
import { tripsApi } from '@/services/api/trips.api';
import type { ValidTripPayload } from '@/services/sync/types';
import type { Trip } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/constants/serverConfig', () => ({
  USE_REAL_SERVER: false,
  LOCAL_SERVER_URL: 'http://localhost:3000',
}));

jest.mock('@/services/api/trips.api', () => ({
  tripsApi: { save: jest.fn() },
}));

const mockSave = tripsApi.save as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayload(localTripId: string): ValidTripPayload {
  return {
    localTripId,
    startTime: '2024-01-01T10:00:00.000Z',
    endTime: '2024-01-01T10:30:00.000Z',
    distanceKm: 15,
    durationSeconds: 1800,
    avgScore: 85,
    points: 120,
    hardBrakes: 1,
    aggressiveAccels: 0,
    sharpTurns: 2,
    swerves: 0,
    touchEpochs: 0,
    screenInteractionSeconds: 0,
    riskMultiplier: 1.0,
    penalties: 9,
  };
}

function makeServerTrip(localTripId: string): Trip {
  return {
    id: `server_${localTripId}`,
    userId: 'user_1',
    startTime: '2024-01-01T10:00:00.000Z',
    endTime: '2024-01-01T10:30:00.000Z',
    distanceKm: 15,
    durationSeconds: 1800,
    avgScore: 85,
    points: 120,
    hardBrakes: 1,
    aggressiveAccels: 0,
    sharpTurns: 2,
    touchEpochs: 0,
    screenInteractionSeconds: 0,
    riskMultiplier: 1.0,
    status: 'completed',
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await SyncManager.clearQueue();
  mockSave.mockReset();
  SyncManager.onTripSynced = undefined;
});

// ─── Enqueue ──────────────────────────────────────────────────────────────────

describe('enqueue', () => {
  test('stores a trip in AsyncStorage', async () => {
    await SyncManager.enqueue(makePayload('trip_001'));
    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  test('deduplication: same localTripId is enqueued only once', async () => {
    await SyncManager.enqueue(makePayload('trip_dup'));
    await SyncManager.enqueue(makePayload('trip_dup'));
    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  test('distinct trips are all enqueued', async () => {
    await SyncManager.enqueue(makePayload('trip_a'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));
    expect(await SyncManager.getQueueLength()).toBe(3);
  });
});

// ─── FlushQueue ───────────────────────────────────────────────────────────────

describe('flushQueue', () => {
  test('syncs 3 queued trips sequentially and clears the queue', async () => {
    mockSave
      .mockResolvedValueOnce(makeServerTrip('trip_a'))
      .mockResolvedValueOnce(makeServerTrip('trip_b'))
      .mockResolvedValueOnce(makeServerTrip('trip_c'));

    await SyncManager.enqueue(makePayload('trip_a'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));

    await SyncManager.flushQueue();

    expect(mockSave).toHaveBeenCalledTimes(3);
    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('halts on first network error and preserves all unprocessed items', async () => {
    mockSave.mockRejectedValueOnce(new Error('Network error'));

    await SyncManager.enqueue(makePayload('trip_a'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));

    await SyncManager.flushQueue();

    // Only trip_a was attempted
    expect(mockSave).toHaveBeenCalledTimes(1);
    // trip_a (failed, attempts=1) + trip_b + trip_c preserved
    expect(await SyncManager.getQueueLength()).toBe(3);
  });

  test('halts after partial success: first trip syncs, second fails, third untouched', async () => {
    mockSave
      .mockResolvedValueOnce(makeServerTrip('trip_ok'))
      .mockRejectedValueOnce(new Error('Network error'));

    await SyncManager.enqueue(makePayload('trip_ok'));
    await SyncManager.enqueue(makePayload('trip_fail'));
    await SyncManager.enqueue(makePayload('trip_untouched'));

    await SyncManager.flushQueue();

    expect(mockSave).toHaveBeenCalledTimes(2);
    // trip_fail (attempts=1) + trip_untouched (attempts=0)
    expect(await SyncManager.getQueueLength()).toBe(2);
  });

  test('409 Conflict is treated as success — item removed from queue', async () => {
    const { ApiError } = await import('@/services/api/client');
    mockSave.mockRejectedValueOnce(new ApiError(409, 'Conflict'));

    await SyncManager.enqueue(makePayload('trip_conflict'));
    await SyncManager.flushQueue();

    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('permanent 4xx error drops the item without halting', async () => {
    const { ApiError } = await import('@/services/api/client');
    mockSave
      .mockRejectedValueOnce(new ApiError(422, 'Unprocessable Entity'))
      .mockResolvedValueOnce(makeServerTrip('trip_b'));

    await SyncManager.enqueue(makePayload('trip_invalid'));
    await SyncManager.enqueue(makePayload('trip_b'));

    await SyncManager.flushQueue();

    // Both processed — 422 dropped, trip_b succeeded
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('concurrent flushQueue calls are deduplicated by the isFlushing mutex', async () => {
    mockSave.mockResolvedValue(makeServerTrip('trip_x'));
    await SyncManager.enqueue(makePayload('trip_x'));

    // Fire two concurrent flushes — only one should actually run
    await Promise.all([SyncManager.flushQueue(), SyncManager.flushQueue()]);

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  test('onTripSynced callback fires with localId and server trip', async () => {
    const serverTrip = makeServerTrip('trip_cb');
    mockSave.mockResolvedValueOnce(serverTrip);

    const onSynced = jest.fn();
    SyncManager.onTripSynced = onSynced;

    await SyncManager.enqueue(makePayload('trip_cb'));
    await SyncManager.flushQueue();

    expect(onSynced).toHaveBeenCalledWith('trip_cb', serverTrip);
  });
});

// ─── Concurrency Safety ───────────────────────────────────────────────────────
//
// These tests probe the two concurrency boundaries in SyncManager:
//
// 1. flushQueue + flushQueue — the module-level isFlushing mutex must block
//    the second caller for the entire duration of an async save, not just
//    synchronously at the entry point.
//
// 2. enqueue + flushQueue — a trip enqueued WHILE a flush is suspended at a
//    slow network save must survive the flush's write-back (D-SYNC-1 fix).
//    The re-read-after-flush logic merges newly arrived items before writing.

describe('concurrency safety', () => {

  test('isFlushing mutex holds across an async save delay — second caller returns immediately', async () => {
    let resolveSlowSave!: (v: Trip) => void;
    const slowSave = new Promise<Trip>(res => { resolveSlowSave = res; });
    mockSave.mockReturnValueOnce(slowSave);

    await SyncManager.enqueue(makePayload('trip_slow'));

    // Start flush1 — it suspends inside the event loop at the pending save.
    // isFlushing is set to true synchronously before the first await, so flush2
    // hits the guard and returns immediately without calling tripsApi.save.
    const flush1 = SyncManager.flushQueue();
    let flush2Resolved = false;
    const flush2 = SyncManager.flushQueue().then(() => { flush2Resolved = true; });

    // flush2 must resolve as a no-op before flush1 completes (no save call needed)
    await flush2;
    expect(flush2Resolved).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1); // only flush1's save is in flight

    // Let flush1 finish
    resolveSlowSave(makeServerTrip('trip_slow'));
    await flush1;

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('item enqueued while a flush is suspended is preserved after the flush write-back', async () => {
    // Scenario (D-SYNC-1): processEndTrip finishes a new trip while a previous
    // offline trip is mid-sync. Without the re-read-after-flush fix, the flush's
    // write-back would overwrite the newly enqueued item and silently lose it.
    let resolveFirstSave!: (v: Trip) => void;
    const firstSave = new Promise<Trip>(res => { resolveFirstSave = res; });
    mockSave
      .mockReturnValueOnce(firstSave)                           // flush1 save — controlled
      .mockResolvedValueOnce(makeServerTrip('trip_mid_flush')); // flush2 save — immediate

    await SyncManager.enqueue(makePayload('trip_before'));

    // Flush1 starts and suspends at the save for trip_before
    const flush1 = SyncManager.flushQueue();

    // Enqueue a second trip while flush1 is suspended (simulates a concurrent trip end)
    await SyncManager.enqueue(makePayload('trip_mid_flush'));

    // Complete flush1 — re-read logic must preserve trip_mid_flush
    resolveFirstSave(makeServerTrip('trip_before'));
    await flush1;

    // trip_mid_flush must survive the write-back
    expect(await SyncManager.getQueueLength()).toBe(1);

    // A second flush drains the preserved item
    await SyncManager.flushQueue();
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(await SyncManager.getQueueLength()).toBe(0);
  });
});
