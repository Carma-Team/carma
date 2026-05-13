import AsyncStorage from '@react-native-async-storage/async-storage';

// סימולטור iOS:       http://localhost:3000
// אמולטור אנדרואיד:   http://10.0.2.2:3000
// מכשיר פיזי (Wi-Fi): http://<IP של המחשב>:3000
// Azure (production): https://carma-api.<region>.azurecontainerapps.io
const BASE_URL = 'http://localhost:3000';

async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('carma_token');
}

/**
 * פונקציית הבסיס לכל בקשות ה-API באפליקציה.
 * מטפלת באופן גלובלי בטוקנים ושגיאות.
 */
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
    throw new Error(data.detail || data.error || 'Request failed');
  }

  return await res.json();
}
