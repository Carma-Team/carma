import AsyncStorage from '@react-native-async-storage/async-storage'

// שימי לב: בפיתוח מקומי, אם אין לך שרת, האפליקציה תשתמש בנתוני Mock
const BASE_URL = 'http://localhost:3000' // או ה-IP שלך

async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('carma_token')
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Request failed')
    }
    return await res.json()
  } catch (error) {
    console.warn(`[API] Fetch failed for ${path}, returning mock data if available.`, error)
    return getMockData(path, options.method) as T
  }
}

/**
 * פונקציה שמחזירה נתונים מזוייפים כדי שהאפליקציה לא תקרוס בלי שרת
 * המבנה כאן מבוסס על מסמך אפיון ה-DB (סעיף 5.3.1)
 */
function getMockData(path: string, method?: string): any {
  // 5.3.1.1 User Entity
  if (path.includes('/api/auth/login') || path.includes('/api/auth/register')) {
    return {
      token: 'mock-token-123',
      user: {
        id: 'user-123',
        name: 'ישראל ישראלי',
        phone: '050-1234567',
        points: 1250, // Matches points in 5.3.1.1
        level: 5,
        language: 'he',
        rank: 'Safe Driver'
      }
    }
  }

  // 5.3.1.2 Trip Entity
  if (path.includes('/api/trips')) {
    const mockTrips = [
      {
        id: 't1',
        user_id: 'user-123',
        start_time: new Date(Date.now() - 3600000 * 2).toISOString(), // לפני שעתיים
        end_time: new Date(Date.now() - 3600000 * 1.5).toISOString(),
        avg_score: 92,
        distance: 12.5,
        events_array: []
      },
      {
        id: 't2',
        user_id: 'user-123',
        start_time: new Date(Date.now() - 86400000).toISOString(), // אתמול
        avg_score: 85,
        distance: 8.2,
        events_array: []
      }
    ]
    return { trips: mockTrips, trip: mockTrips[0] }
  }

  // 5.3.1.3 & 5.3.1.4 Reward & Businesses
  if (path.includes('/api/rewards')) {
    // 5.3.1.5 Redemption logic (POST)
    if (method === 'POST') {
      const rewardId = path.split('/').reverse()[1];
      return {
        voucher: {
          id: `red-${Date.now()}`, // 5.3.1.5 Redemption ID
          user_id: 'user-123',
          reward_id: rewardId,
          qr_code: `CARMA-${Math.random().toString(36).toUpperCase().substring(2, 8)}`,
          status: 'active',
          created_at: new Date().toISOString(),
          expired_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          reward: { imageEmoji: '🎁', title: 'הפרס שלך' }
        }
      }
    }

    // List & Filter logic
    const url = new URL(path, 'http://localhost');
    const categoryParam = url.searchParams.get('category');

    const allRewards: any[] = [
      { id: 'r1', business_id: 'b1', description: '50 ש"ח הנחה בתדלוק', cost_points: 500, imageEmoji: '⛽', category: 'fuel', business_name: 'Paz' },
      { id: 'r2', business_id: 'b2', description: 'קפה ומאפה חינם', cost_points: 150, imageEmoji: '☕', category: 'food', business_name: 'Arcaffe' },
      { id: 'r3', business_id: 'b3', description: 'שטיפת רכב חיצונית', cost_points: 300, imageEmoji: '🚗', category: 'shopping', business_name: 'CityWash' },
      { id: 'r4', business_id: 'b4', description: 'כרטיס לסרט', cost_points: 400, imageEmoji: '🎬', category: 'entertainment', business_name: 'Cinema City' },
    ]

    const filteredRewards = categoryParam && categoryParam !== 'all'
      ? allRewards.filter(r => r.category === categoryParam)
      : allRewards;

    return { rewards: filteredRewards, vouchers: [] }
  }

  if (path.includes('/api/leaderboard')) {
    return {
      entries: [
        { id: 'e1', user_id: 'user-123', rank: 1, score: 95, user: { name: 'אתה', city: 'תל אביב' } },
        { id: 'e2', user_id: 'anon-1', rank: 2, score: 88, user: { name: 'אלמוני', city: 'חיפה' } }
      ]
    }
  }

  return {}
}

// ─── API Methods with DB Mapping Reference ──────────────────────────────────

export const authApi = {
  /** 5.3.1.1 User */
  login: (email: string, password: string) =>
    request<any>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<any>('/api/auth/me'),
}

export const tripsApi = {
  /** 5.3.1.2 Trip & 5.3.2.1 User-Trips (One-to-Many) */
  list: () => request<any>('/api/trips'),
  start: () => request<any>('/api/trips', { method: 'POST', body: JSON.stringify({ action: 'start' }) }),
}

export const rewardsApi = {
  /** 5.3.1.3 Reward & 5.3.1.4 Businesses */
  list: (category?: string) =>
    request<any>(`/api/rewards${category ? `?category=${category}` : ''}`),

  /** 5.3.1.5 Redemption & 5.3.2.3 User-Redemptions (One-to-Many) */
  redeem: (rewardId: string) =>
    request<any>(`/api/rewards/${rewardId}/redeem`, { method: 'POST' }),
}

export const leaderboardApi = {
  get: (type: string) => request<any>(`/api/leaderboard?type=${type}`),
}

export const userApi = {
  stats: () => request<any>('/api/user/stats'),
}

export const notificationsApi = {
  list: () => request<any>('/api/notifications'),
}
