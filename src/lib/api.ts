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
 */
function getMockData(path: string, method?: string): any {
  if (path.includes('/api/auth/login') || path.includes('/api/auth/register')) {
    return {
      token: 'mock-token-123',
      user: {
        id: 'user-123',
        name: 'ישראל ישראלי',
        email: 'test@carma.com',
        level: 5,
        xp: 2500,
        carmaPoints: 1250,
        rank: 'Safe Driver'
      }
    }
  }
  if (path.includes('/api/user/stats')) {
    return { stats: { totalPoints: 1250, totalDistance: 154.2, tripsCount: 12, level: 5, rank: 'Safe Driver' } }
  }
  if (path.includes('/api/leaderboard')) {
    /**
     * הערה לפיתוח: הנתונים כאן כרגע סטטיים (Mock).
     * בעתיד, הנתונים ימשכו ממאגר נתונים (Database) לפי סוג הטבלה:
     * - טאב "חברים": נתונים ממאגר חברי המשתמש.
     * - טאב "עיר": נתונים ממאגר משותף של כל משתמשי האפליקציה באותה עיר.
     * - טאב "ארצי": נתונים ממאגר כללי של כל משתמשי האפליקציה בישראל.
     */
    return {
      entries: [
        {
          id: 'guest-123',
          userId: 'guest-123',
          rank: 1,
          score: 95,
          user: {
            name: 'אתה (משתמש אורח)',
            city: 'תל-אביב',
            level: 5
          }
        },
        {
          id: 'anon-1',
          userId: 'anon-1',
          rank: 2,
          score: 98,
          user: {
            name: 'אלמוני',
            city: 'ישראל',
            level: 3
          }
        }
      ],
      currentUserId: 'guest-123'
    }
  }
  if (path.includes('/api/notifications')) {
    return { notifications: [] }
  }
  if (path.includes('/api/rewards') && method === 'POST') {
    // Mock for redeeming a reward
    const rewardId = path.split('/').reverse()[1];
    return {
      voucher: {
        id: `v-${Date.now()}`,
        code: `CARMA-${Math.random().toString(36).toUpperCase().substring(2, 8)}`,
        rewardId: rewardId,
        isUsed: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        qrData: 'mock-qr-data',
        reward: { imageEmoji: '🎁', title: 'הפרס החדש שלך' } // In real DB this would be a JOIN with rewards table
      }
    }
  }

  if (path.includes('/api/rewards')) {
    /**
     * DATABASE MAPPING:
     * - This data comes from the "rewards" table.
     * - Category filtering is done via a SQL query: SELECT * FROM rewards WHERE category = ?
     */
    const mockRewards: import('@/navigation/types').Reward[] = [
      { id: 'r1', title: '50 ש"ח הנחה בתדלוק', titleEn: '50 ILS Fuel Discount', business: 'Paz', pointsCost: 500, imageEmoji: '⛽', category: 'fuel', stock: 100 },
      { id: 'r2', title: 'קפה ומאפה חינם', titleEn: 'Free Coffee & Pastry', business: 'Arcaffe', pointsCost: 150, imageEmoji: '☕', category: 'food', stock: 50 },
      { id: 'r3', title: 'שטיפת רכב חיצונית', titleEn: 'Exterior Car Wash', business: 'CityWash', pointsCost: 300, imageEmoji: '🚗', category: 'shopping', stock: 20 },
      { id: 'r4', title: 'כרטיס לסרט', titleEn: 'Cinema Ticket', business: 'Cinema City', pointsCost: 400, imageEmoji: '🎬', category: 'entertainment', stock: 15 },
    ]
    return { rewards: mockRewards, vouchers: [] }
  }
  if (path.includes('/api/trips')) {
    return { trips: [], trip: null }
  }
  return {}
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: import('@/navigation/types').AppUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (payload: any) =>
    request<{ user: import('@/navigation/types').AppUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  me: () => request<{ user: import('@/navigation/types').AppUser }>('/api/auth/me'),
}

// ─── Trips ───────────────────────────────────────────────────────────────────
export const tripsApi = {
  list: (limit = 20) =>
    request<{ trips: import('@/navigation/types').Trip[] }>(`/api/trips?limit=${limit}`),

  get: (id: string) =>
    request<{ trip: import('@/navigation/types').Trip }>(`/api/trips/${id}`),

  start: () =>
    request<{ trip: import('@/navigation/types').Trip }>('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
    }),

  end: (payload: any) =>
    request<{ trip: import('@/navigation/types').Trip; scoring: import('@/navigation/types').ScoringResult }>('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ action: 'end', ...payload }),
    }),
}

// ─── Rewards ─────────────────────────────────────────────────────────────────
export const rewardsApi = {
  list: (category?: string) =>
    request<{ rewards: import('@/navigation/types').Reward[]; vouchers: import('@/navigation/types').Voucher[] }>(
      `/api/rewards${category && category !== 'all' ? `?category=${category}` : ''}`
    ),

  redeem: (rewardId: string) =>
    request<{ voucher: import('@/navigation/types').Voucher }>(`/api/rewards/${rewardId}/redeem`, { method: 'POST' }),
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
export const leaderboardApi = {
  get: (type: string) =>
    request<{ entries: import('@/navigation/types').LeaderboardEntry[]; currentUserId: string }>(
      `/api/leaderboard?type=${type}`
    ),
}

// ─── User stats ──────────────────────────────────────────────────────────────
export const userApi = {
  stats: () => request<{ stats: import('@/navigation/types').DrivingStats }>('/api/user/stats'),
}

// ─── Notifications ───────────────────────────────────────────────────────────
export const notificationsApi = {
  list: () => request<{ notifications: import('@/navigation/types').Notification[] }>('/api/notifications'),
}
