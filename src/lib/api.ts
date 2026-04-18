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
    return getMockData(path) as T
  }
}

/**
 * פונקציה שמחזירה נתונים מזוייפים כדי שהאפליקציה לא תקרוס בלי שרת
 */
function getMockData(path: string): any {
  if (path.includes('/api/user/stats')) {
    return { stats: { totalPoints: 1250, totalDistance: 154.2, tripsCount: 12, level: 5, rank: 'Safe Driver' } }
  }
  if (path.includes('/api/leaderboard')) {
    return { entries: [
      { id: '1', name: 'ישראל ישראלי', score: 98, points: 5000, avatar: 'https://i.pravatar.cc/150?u=1' },
      { id: '2', name: 'יוסי כהן', score: 92, points: 4200, avatar: 'https://i.pravatar.cc/150?u=2' },
      { id: 'guest-123', name: 'Guest User', score: 95, points: 1250, avatar: 'https://i.pravatar.cc/150?u=guest' }
    ], currentUserId: 'guest-123' }
  }
  if (path.includes('/api/notifications')) {
    return { notifications: [] }
  }
  if (path.includes('/api/rewards')) {
    return { rewards: [], vouchers: [] }
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
