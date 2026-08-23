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
