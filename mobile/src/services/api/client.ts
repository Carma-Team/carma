/**
 * @fileoverview Central HTTP client — all server requests go through here
 * @module services/api/client
 *
 * @description
 * `request<T>` function that handles:
 * - Loading the token from AsyncStorage and attaching it as an Authorization header
 * - Sending the request to BASE_URL (local server or real server per USE_REAL_SERVER)
 * - Handling HTTP errors and 204 No Content responses
 *
 * @server
 * - USE_REAL_SERVER=false: requests → LOCAL_SERVER_URL (carma-local-server must be running)
 * - USE_REAL_SERVER=true:  requests → real server (update REAL_SERVER_URL accordingly)
 *
 * For a physical device: change LOCAL_SERVER_URL in serverConfig.ts to your machine's IP
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_REAL_SERVER, LOCAL_SERVER_URL, STAGING_SERVER_URL } from '@/constants/serverConfig';

// Carries the HTTP status so callers (e.g. SyncManager) can distinguish 4xx from network errors
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
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
    throw new ApiError(res.status, data.detail || data.error || 'Request failed');
  }

  if (res.status === 204) return undefined as unknown as T;
  return await res.json();
}
