import { USE_REAL_SERVER, LOCAL_SERVER_URL, STAGING_SERVER_URL } from '@/constants/serverConfig';

const BASE_URL = USE_REAL_SERVER ? STAGING_SERVER_URL : LOCAL_SERVER_URL;

/** Returns true if the server is reachable. Uses the lightweight liveness probe (no DB check). */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health/live`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
