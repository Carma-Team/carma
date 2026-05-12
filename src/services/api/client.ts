import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMockData } from './mocks/mockData';

const BASE_URL = 'http://localhost:3000'; // כאן תבוא הכתובת של השרת האמיתי שלך

async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('carma_token');
}

/**
 * פונקציית הבסיס לכל בקשות ה-API באפליקציה.
 * מטפלת באופן גלובלי בטוקנים, שגיאות וסימולציות מנהל.
 */
export async function request<T>(
  path: string,
  options: RequestInit & { public?: boolean } = {}
): Promise<T> {
  const token = options.public ? null : await getAuthToken();

  // לוגיקת סימולציה למנהל מערכת (Admin)
  if (token === 'mock-admin-token') {
    await new Promise(resolve => setTimeout(resolve, 300));
    console.log(`[API MOCK] Simulating DB call for: ${path}`);
    return getMockData(path, options.method) as T;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed');
    }

    return await res.json();
  } catch (error) {
    // FALLBACK LOGIC:
    // 1. אם מדובר ב-GET (תמיד מאפשרים Mock אם השרת למטה)
    // 2. אם מדובר ב-POST להתחברות/הרשמה (מאפשרים Mock כדי שלא נתקע בפיתוח)
    const isAuth = path.includes('/api/auth/login') || path.includes('/api/auth/register');

    if (!options.method || options.method === 'GET' || isAuth) {
      console.warn(`[API] Server unreachable for ${path}. Falling back to MOCK for development.`);
      return getMockData(path, options.method) as T;
    }

    throw error;
  }
}
