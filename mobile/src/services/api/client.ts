/**
 * @fileoverview Central HTTP client — all server requests go through here
 * @module services/api/client
 *
 * @description
 * `request<T>` function that handles:
 * - Loading the token from AsyncStorage and attaching it as an Authorization header
 * - Sending the request to BASE_URL (STAGING_SERVER_URL, per USE_REAL_SERVER)
 * - Handling HTTP errors and 204 No Content responses
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_REAL_SERVER, LOCAL_SERVER_URL, STAGING_SERVER_URL } from '@/constants/serverConfig';

// Carries the HTTP status so callers (e.g. SyncManager) can distinguish 4xx from network errors
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Seconds the server asked us to wait before retrying. Only ever set on a 429.
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The server sends the wait twice — `Retry-After` and a `retryAfterSeconds` body field.
// Prefer the body: it is already a number, while the header is a string and the HTTP-date
// form of it is not something our server ever emits.
function parseRetryAfter(header: string | null, bodyValue: unknown): number | undefined {
  const seconds = typeof bodyValue === 'number' ? bodyValue : Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

const BASE_URL = USE_REAL_SERVER ? STAGING_SERVER_URL : LOCAL_SERVER_URL;

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

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      data.detail || data.error || 'Request failed',
      parseRetryAfter(res.headers.get('Retry-After'), data.retryAfterSeconds)
    );
  }

  if (res.status === 204) return undefined as unknown as T;
  return await res.json();
}
