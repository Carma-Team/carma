import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SyncManager, BACKOFF_MS, MAX_QUEUE_AGE_MS, STUCK_AFTER, QUEUE_KEY,
} from '@/services/sync/SyncManager';
import { ApiError } from '@/services/api/client';
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
    phoneMotionSeconds: 0,
    screenInteractionSeconds: 0,
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
    effectiveRiskMultiplier: 1.0,
    status: 'completed',
    startLocation: null,
    endLocation: null,
    aiInsight: null,
    accelAvailable: null,
    accelInitFailed: null,
    pointsCapped: false,
    imuDegraded: false,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await SyncManager.clearQueue();
  mockSave.mockReset();
  SyncManager.onTripSynced = undefined;
  SyncManager.onTripAbandoned = undefined;
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
    mockSave.mockRejectedValueOnce(new ApiError(409, 'Conflict'));

    await SyncManager.enqueue(makePayload('trip_conflict'));
    await SyncManager.flushQueue();

    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('permanent 4xx error drops the item without halting', async () => {
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

// ─── Retry budget and backoff (CAR-138) ───────────────────────────────────────
// A trip the driver completed must not be deleted because the upload could not get
// through. These tests hold the line at the two answers that used to delete one:
// no network, and a rate limit shared with every other driver behind the same NAT.
//
// The clock is stubbed rather than injected — the backoff is a real wall-clock wait,
// and production code should not carry a seam that exists only for tests.

describe('retry budget and backoff', () => {
  const RATE_LIMIT_WAIT_SECONDS = 60;
  const LONGEST_BACKOFF_MS = BACKOFF_MS[BACKOFF_MS.length - 1];

  let clock = 0;

  function rateLimited(): ApiError {
    return new ApiError(429, 'Too many attempts. Try again shortly.', RATE_LIMIT_WAIT_SECONDS);
  }

  beforeEach(() => {
    clock = Date.parse('2026-08-05T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a trip survives more than five 429 responses', async () => {
    mockSave.mockRejectedValue(rateLimited());
    await SyncManager.enqueue(makePayload('trip_429'));

    for (let i = 0; i < 8; i++) {
      await SyncManager.flushQueue();
      clock += RATE_LIMIT_WAIT_SECONDS * 1000; // wait exactly what the server asked for
    }

    expect(mockSave).toHaveBeenCalledTimes(8);
    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  test('a trip survives more than five network failures', async () => {
    mockSave.mockRejectedValue(new Error('Network request failed'));
    await SyncManager.enqueue(makePayload('trip_offline'));

    for (let i = 0; i < 8; i++) {
      await SyncManager.flushQueue();
      clock += LONGEST_BACKOFF_MS;
    }

    expect(mockSave).toHaveBeenCalledTimes(8);
    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  test('a failed trip is not retried before its backoff has elapsed', async () => {
    mockSave.mockRejectedValue(new Error('Network request failed'));
    await SyncManager.enqueue(makePayload('trip_backoff'));

    await SyncManager.flushQueue();
    expect(mockSave).toHaveBeenCalledTimes(1);

    clock += BACKOFF_MS[0] - 1; // one millisecond short of the first interval
    await SyncManager.flushQueue();
    expect(mockSave).toHaveBeenCalledTimes(1);

    clock += 1;
    await SyncManager.flushQueue();
    expect(mockSave).toHaveBeenCalledTimes(2);
  });

  test('429s never bring a trip closer to being given up on, however many arrive', async () => {
    mockSave.mockRejectedValue(rateLimited());
    await SyncManager.enqueue(makePayload('trip_throttled'));

    for (let i = 0; i < 55; i++) {
      await SyncManager.flushQueue();
      clock += RATE_LIMIT_WAIT_SECONDS * 1000;
    }

    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  // The counter that used to delete a trip is gone. Age is the only bound, so no number of
  // failures inside it may lose a drive the driver actually took — this is CAR-138's line.
  test('a trip under the age bound survives far more failures than the old budget allowed', async () => {
    const onAbandoned = jest.fn();
    SyncManager.onTripAbandoned = onAbandoned;
    mockSave.mockRejectedValue(new Error('Network request failed'));
    await SyncManager.enqueue(makePayload('trip_stubborn'));

    for (let i = 0; i < 55; i++) {
      await SyncManager.flushQueue();
      clock += LONGEST_BACKOFF_MS;   // 55 hours total, far inside the 30-day bound
    }

    expect(mockSave).toHaveBeenCalledTimes(55);
    expect(onAbandoned).not.toHaveBeenCalled();
    expect(await SyncManager.getQueueLength()).toBe(1);
  });
});

// ─── Age bound (CAR-166) ──────────────────────────────────────────────────────
// A trip that outlives the bound leaves the queue, but is abandoned rather than deleted:
// the row stays on the device flagged as never sent, which is what AppContext wires
// `onTripAbandoned` to do.

describe('age bound', () => {
  let clock = 0;

  beforeEach(() => {
    clock = Date.parse('2026-09-07T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a trip past the age bound is abandoned, and is not attempted again first', async () => {
    const onAbandoned = jest.fn();
    SyncManager.onTripAbandoned = onAbandoned;
    await SyncManager.enqueue(makePayload('trip_old'));

    clock += MAX_QUEUE_AGE_MS;
    await SyncManager.flushQueue();

    expect(onAbandoned).toHaveBeenCalledWith('trip_old');
    expect(mockSave).not.toHaveBeenCalled();
    expect(await SyncManager.getQueueLength()).toBe(0);
  });

  test('a trip one millisecond short of the bound is still retried', async () => {
    const onAbandoned = jest.fn();
    SyncManager.onTripAbandoned = onAbandoned;
    mockSave.mockRejectedValue(new Error('Network request failed'));
    await SyncManager.enqueue(makePayload('trip_almost'));

    clock += MAX_QUEUE_AGE_MS - 1;
    await SyncManager.flushQueue();

    expect(onAbandoned).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(await SyncManager.getQueueLength()).toBe(1);
  });
});

// ─── Request timeout ──────────────────────────────────────────────────────────

describe('request timeout (408)', () => {
  let clock = 0;

  beforeEach(() => {
    clock = Date.parse('2026-09-05T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 408 is the one 4xx that must not be permanent: the request never reached an
  // answer, so the trip is still unsent. Extending PERMANENT_FAILURE_STATUSES with
  // it would delete a completed trip instead of sending it on the next attempt.
  test('a trip whose upload times out stays queued and is retried', async () => {
    mockSave.mockRejectedValueOnce(new ApiError(408, 'Request timed out after 30s'));
    await SyncManager.enqueue(makePayload('trip_timeout'));

    await SyncManager.flushQueue();
    expect(await SyncManager.getQueueLength()).toBe(1);

    clock += BACKOFF_MS[0];
    mockSave.mockResolvedValueOnce(makeServerTrip('trip_timeout'));
    await SyncManager.flushQueue();

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(await SyncManager.getQueueLength()).toBe(0);
  });
});

// ─── Stuck head item (CAR-311) ────────────────────────────────────────────────
// The queue halts on the first item it cannot send, which is what keeps uploads in order.
// The cost was that one trip the server will not take blocked every trip behind it for as
// long as it stayed queued. A stuck item is now stepped over instead, and whether the items
// behind it then succeed is the evidence separating a broken trip from a broken network —
// something no attempt counter on the head item alone can tell apart.

describe('stuck head item', () => {
  const LONGEST_BACKOFF_MS = BACKOFF_MS[BACKOFF_MS.length - 1];
  const RATE_LIMIT_WAIT_SECONDS = 60;

  let clock = 0;

  beforeEach(() => {
    clock = Date.parse('2026-09-07T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Outcome per trip id, so a pass that walks several items resolves each one the same way
  // however many times it is reached.
  function saveBy(outcomes: Record<string, 'ok' | 'fail'>) {
    mockSave.mockImplementation((payload: ValidTripPayload) =>
      outcomes[payload.localTripId] === 'ok'
        ? Promise.resolve(makeServerTrip(payload.localTripId))
        : Promise.reject(new Error('Network request failed')),
    );
  }

  // Walks the head up to STUCK_AFTER consecutive failures. Every pass halts on it, so the
  // items behind are untouched and the call count is exactly one per pass.
  async function makeHeadStuck() {
    for (let i = 0; i < STUCK_AFTER; i++) {
      await SyncManager.flushQueue();
      clock += LONGEST_BACKOFF_MS;
    }
    expect(mockSave).toHaveBeenCalledTimes(STUCK_AFTER);
  }

  test('the queue drains past a stuck head instead of waiting on it', async () => {
    saveBy({ trip_stuck: 'fail', trip_b: 'ok', trip_c: 'ok' });
    await SyncManager.enqueue(makePayload('trip_stuck'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));

    await makeHeadStuck();
    expect(await SyncManager.getQueueLength()).toBe(3);

    await SyncManager.flushQueue();

    // The head is attempted first and fails, then both trips behind it go through
    expect(mockSave).toHaveBeenCalledTimes(STUCK_AFTER + 3);
    expect(await SyncManager.getQueueLength()).toBe(1);
  });

  test('a real outage still halts — the skip costs one extra request, not a whole walk', async () => {
    saveBy({ trip_stuck: 'fail', trip_b: 'fail', trip_c: 'fail' });
    await SyncManager.enqueue(makePayload('trip_stuck'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));

    await makeHeadStuck();
    await SyncManager.flushQueue();

    // Head plus exactly one item behind it — trip_c is never reached
    expect(mockSave).toHaveBeenCalledTimes(STUCK_AFTER + 2);
    expect(await SyncManager.getQueueLength()).toBe(3);
  });

  test('a stepped-over item keeps its place at the head of the queue', async () => {
    saveBy({ trip_stuck: 'fail', trip_b: 'ok', trip_c: 'fail' });
    await SyncManager.enqueue(makePayload('trip_stuck'));
    await SyncManager.enqueue(makePayload('trip_b'));
    await SyncManager.enqueue(makePayload('trip_c'));

    await makeHeadStuck();
    await SyncManager.flushQueue();

    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    expect(JSON.parse(raw as string).map((i: { id: string }) => i.id)).toEqual([
      'trip_stuck',
      'trip_c',
    ]);
  });

  // A rate limit is shared with every other driver behind the same carrier NAT, so the
  // trips behind the head would meet it too. Stepping over the head would spend a request
  // to learn nothing, which is why a 429 never advances `failures`.
  test('a head that only ever gets rate-limited is never stepped over', async () => {
    mockSave.mockRejectedValue(new ApiError(429, 'Too many attempts', RATE_LIMIT_WAIT_SECONDS));
    await SyncManager.enqueue(makePayload('trip_throttled_head'));
    await SyncManager.enqueue(makePayload('trip_behind'));

    for (let i = 0; i < STUCK_AFTER + 3; i++) {
      await SyncManager.flushQueue();
      clock += RATE_LIMIT_WAIT_SECONDS * 1000;
    }

    // One attempt per pass, every one of them the head
    expect(mockSave).toHaveBeenCalledTimes(STUCK_AFTER + 3);
    for (const [payload] of mockSave.mock.calls) {
      expect(payload.localTripId).toBe('trip_throttled_head');
    }
    expect(await SyncManager.getQueueLength()).toBe(2);
  });
});
