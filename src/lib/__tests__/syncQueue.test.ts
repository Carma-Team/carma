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
    phoneSeconds: 10,
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
    phoneSeconds: 10,
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
