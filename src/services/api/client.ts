/**
 * @fileoverview לקוח HTTP מרכזי — כל הבקשות לשרת עוברות דרך כאן
 * @module services/api/client
 *
 * @description
 * פונקציה `request<T>` שמטפלת ב:
 * - שליפת token מ-AsyncStorage והוספתו ל-Authorization header
 * - שליחת בקשה ל-BASE_URL (השרת המקומי או שרת נווה לפי USE_REAL_SERVER)
 * - טיפול בשגיאות HTTP ובתשובת 204 No Content
 *
 * @server
 * - USE_REAL_SERVER=false: בקשות → LOCAL_SERVER_URL (carma-local-server, חייב לרוץ)
 * - USE_REAL_SERVER=true:  בקשות → שרת נווה (עדכן REAL_SERVER_URL בהתאם)
 *
 * לטלפון אמיתי: שנה LOCAL_SERVER_URL ב-serverConfig.ts ל-IP של המחשב
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_REAL_SERVER, LOCAL_SERVER_URL } from '@/constants/serverConfig';

const REAL_SERVER_URL = 'https://carma-api.example.com'; // TODO: עדכן לכתובת השרת של נווה
const BASE_URL = USE_REAL_SERVER ? REAL_SERVER_URL : LOCAL_SERVER_URL;

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
    throw new Error(data.detail || data.error || 'Request failed');
  }

  if (res.status === 204) return undefined as unknown as T;
  return await res.json();
}
