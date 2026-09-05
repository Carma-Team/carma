/**
 * @fileoverview Central HTTP client — all server requests go through here
 * @module services/api/client
 *
 * @description
 * `request<T>` function that handles:
 * - Loading the token from AsyncStorage and attaching it as an Authorization header
 * - Sending the request to BASE_URL (STAGING_SERVER_URL, per USE_REAL_SERVER)
 * - Handling HTTP errors and 204 No Content responses
 * - Capping every request at REQUEST_TIMEOUT_MS, so one that never answers rejects
 *   as a retryable 408 instead of hanging the caller forever
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_REAL_SERVER, LOCAL_SERVER_URL, STAGING_SERVER_URL } from '@/constants/serverConfig';

// Carries the HTTP status so callers (e.g. SyncManager) can distinguish 4xx from network errors
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Seconds the server asked us to wait before retrying — a 429, or a redemption
    // refused while a cooldown or the live-voucher cap is still holding.
    public readonly retryAfterSeconds?: number,
    // The server's machine-readable reason, when it sent one. Branch on this and
    // never on the message: the codes are a contract, the wording is English prose
    // that changes freely (server/app/services/rewards.py).
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// `detail` is not always a string. Our 409s send `{code, message}` so a client can
// tell "out of stock" from "campaign ended", and FastAPI's own 422 sends an array
// of `{loc, msg, type}`. Either one handed to `Error()` becomes the literal text
// "[object Object]", which is what reached the logs on a failed redemption.
function parseDetail(detail: unknown): { message?: string; code?: string; retryAfterSeconds?: number } {
  if (typeof detail === 'string') return { message: detail };
  if (Array.isArray(detail)) return parseDetail(detail[0]);
  if (detail !== null && typeof detail === 'object') {
    const { message, msg, code, retryAfterSeconds } = detail as Record<string, unknown>;
    const text = message ?? msg;
    return {
      message: typeof text === 'string' ? text : undefined,
      code: typeof code === 'string' ? code : undefined,
      // Numbers only, so a malformed nested value cannot shadow a good one at the
      // top of the body — rate limiting reads the same field through this path.
      retryAfterSeconds: typeof retryAfterSeconds === 'number' ? retryAfterSeconds : undefined,
    };
  }
  return {};
}

// Two shapes, not one: rate limiting puts the wait at the top of the body, while the
// redemption 409s put it beside the code inside `detail` (server/app/services/rewards.py).
// Reading only the top level is why a cooldown refusal arrived with no wait attached.
//
// The server sends the wait twice — `Retry-After` and a `retryAfterSeconds` body field.
// Prefer the body: it is already a number, while the header is a string and the HTTP-date
// form of it is not something our server ever emits.
function parseRetryAfter(header: string | null, bodyValue: unknown): number | undefined {
  const seconds = typeof bodyValue === 'number' ? bodyValue : Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

const BASE_URL = USE_REAL_SERVER ? STAGING_SERVER_URL : LOCAL_SERVER_URL;

// React Native hands OkHttp a timeout of 0 on Android, so a request that never answers
// hangs for the life of the process — and one hung upload stalls the whole sync queue
// until the app restarts. 30s: OkHttp's own default is 10s, AWS recommends staying
// under 30s on mobile, and a slow cellular save should still be given room to finish.
const REQUEST_TIMEOUT_MS = 30_000;

async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('carma_token');
}

export async function request<T>(
  path: string,
  options: RequestInit & { public?: boolean } = {}
): Promise<T> {
  const token = options.public ? null : await getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // A multipart body carries its own content type, and it has to include the boundary
  // the runtime generated. Setting the header ourselves overwrites that boundary, and
  // the server then reads an empty form with no error worth the name.
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 408 and not a bare network error: a timeout has to be retryable. SyncManager drops
  // an item on a 4xx it knows (400/401/403/422) and retries everything else, so 408
  // keeps the trip in the queue while still naming the reason it failed.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(408, `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // `?? {}` and not just the catch: a body of literal `null` parses fine, and
    // reading `.detail` off it would throw a TypeError over the real HTTP error.
    const data = (await res.json().catch(() => null)) ?? {};
    const { message, code, retryAfterSeconds } = parseDetail(data.detail);
    throw new ApiError(
      res.status,
      message || parseDetail(data.error).message || 'Request failed',
      parseRetryAfter(res.headers.get('Retry-After'), retryAfterSeconds ?? data.retryAfterSeconds),
      code
    );
  }

  if (res.status === 204) return undefined as unknown as T;
  return await res.json();
}
