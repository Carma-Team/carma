import { request, ApiError } from '@/services/api/client';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/constants/serverConfig', () => ({
  USE_REAL_SERVER: false,
  LOCAL_SERVER_URL: 'http://localhost:3000',
  STAGING_SERVER_URL: 'http://staging.invalid',
}));

/** One failed response, with whatever body the server chose to send. */
function respondWith(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
    headers: { get: () => null },
  }) as unknown as typeof fetch;
}

async function failedRequest(): Promise<ApiError> {
  try {
    await request('/api/rewards/r1/redeem', { method: 'POST' });
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to reject');
}

describe('request — error detail', () => {
  it('reads the message and the code out of an object detail', async () => {
    respondWith(409, { detail: { code: 'REWARD_OUT_OF_STOCK', message: 'This reward is out of stock' } });
    const error = await failedRequest();

    expect(error.status).toBe(409);
    expect(error.message).toBe('This reward is out of stock');
    expect(error.code).toBe('REWARD_OUT_OF_STOCK');
  });

  it("takes the first entry's msg out of a 422 validation array", async () => {
    respondWith(422, { detail: [{ loc: ['body', 'rewardId'], msg: 'field required', type: 'missing' }] });
    const error = await failedRequest();

    expect(error.message).toBe('field required');
    expect(error.code).toBeUndefined();
  });

  it('still passes a plain string detail straight through', async () => {
    respondWith(400, { detail: 'Insufficient points' });
    const error = await failedRequest();

    expect(error.message).toBe('Insufficient points');
  });

  it('falls back when the body carries no detail at all', async () => {
    respondWith(500, {});
    const error = await failedRequest();

    expect(error.message).toBe('Request failed');
  });
});

describe('request — timeout', () => {
  afterEach(() => jest.useRealTimers());

  it('rejects a request that never answers as a retryable 408', async () => {
    jest.useFakeTimers();
    // A fetch that only ever settles when its signal aborts — the Android case the
    // cap exists for, where OkHttp's timeout is 0 and nothing else ends the call.
    global.fetch = jest.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    ) as unknown as typeof fetch;

    // `public` keeps the token read out of the way: the AsyncStorage mock resolves on
    // a timer that fake timers hold, and the request would not reach fetch at all.
    const pending = request('/api/trips', { method: 'POST', public: true });
    const settled = expect(pending).rejects.toMatchObject({ status: 408 });
    jest.advanceTimersByTime(30_000);
    await settled;
  });

  it('leaves a normal response alone and clears its timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 7 }),
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    await expect(request('/api/trips', { method: 'POST' })).resolves.toEqual({ id: 7 });
    expect(jest.getTimerCount()).toBe(0);
  });
});
