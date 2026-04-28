/**
 * נתוני Mock לשימוש בפיתוח וכאשר השרת אינו זמין.
 * המבנה תואם לאפיון ה-DB (סעיף 5.3.1).
 */
export function getMockData(path: string, method?: string): any {
  // 5.3.1.1 User Entity
  if (path.includes('/api/auth/login') || path.includes('/api/auth/register')) {
    return {
      token: 'mock-token-123',
      user: {
        id: 'user-123',
        name: 'ישראל ישראלי',
        email: 'test@carma.com',
        role: 'driver',
        points: 1250,
        level: 5,
        rank: 'Safe Driver'
      }
    };
  }

  // 5.3.1.2 Trip Entity
  if (path.includes('/api/trips')) {
    return {
      trips: [
        { id: 't1', distance: 12.5, avg_score: 92, start_time: new Date().toISOString() },
        { id: 't2', distance: 8.2, avg_score: 85, start_time: new Date(Date.now() - 86400000).toISOString() }
      ]
    };
  }

  // 5.3.1.3 Reward Entity
  if (path.includes('/api/rewards')) {
    if (method === 'POST') {
      return { voucher: { id: 'v123', qr_code: 'CARMA-MOCK', status: 'active' } };
    }
    return {
      rewards: [
        {
          id: 'r1',
          business_name: 'Paz',
          title: '50 ש"ח הנחה בתדלוק',
          description: '50 ש"ח הנחה בתדלוק בכל תחנות פז',
          cost_points: 500,
          imageEmoji: '⛽',
          category: 'fuel'
        },
        {
          id: 'r2',
          business_name: 'Arcaffe',
          title: 'קפה ומאפה חינם',
          description: 'קפה ומאפה חינם בכל סניפי ארקפה',
          cost_points: 150,
          imageEmoji: '☕',
          category: 'food'
        },
        {
          id: 'r3',
          business_name: 'Lime',
          title: '15 דקות נסיעה בחינם',
          description: '15 דקות נסיעה בחינם בקורקינט חשמלי',
          cost_points: 300,
          imageEmoji: '🛴',
          category: 'eco'
        },
        {
          id: 'r4',
          business_name: 'Cinema City',
          title: 'כרטיס VIP לסרט',
          description: 'כרטיס כניסה למתחם ה-VIP בסינמה סיטי',
          cost_points: 1200,
          imageEmoji: '🎬',
          category: 'entertainment'
        },
        {
          id: 'r5',
          business_name: 'Super-Pharm',
          title: '20% הנחה על מוצרי טיפוח',
          description: 'קופון הנחה למחלקת הקוסמטיקה',
          cost_points: 400,
          imageEmoji: '🧴',
          category: 'shopping'
        }
      ],
      vouchers: []
    };
  }

  if (path.includes('/api/leaderboard')) {
    return {
      entries: [
        { id: 'e1', name: 'יוסי כהן', score: 98, rank: 1, points: 4500 },
        { id: 'e2', name: 'אתה', score: 95, rank: 2, points: 4200 }
      ],
      currentUserId: 'user-123'
    };
  }

  if (path.includes('/api/stats')) {
    return {
      stats: {
        totalTrips: 45,
        totalDistance: 1250.4,
        totalPoints: 1250,
        averageScore: 92,
        safeTripsCount: 38,
        totalDurationSeconds: 154800
      }
    };
  }

  return {};
}
