/**
 * נתוני Mock לשימוש בפיתוח וכאשר השרת אינו זמין.
 * המבנה תואם לאפיון ה-DB (סעיף 5.3.1).
 */

const CURRENT_USER_ID = 'user-123';

// בסיס נתונים מרכזי של משתמשים לדירוג
const ALL_USERS = [
  { id: 'user-123', name: 'ישראל ישראלי', city: 'תל אביב', country: 'ישראל', score: 95, level: 5, isFriend: false },
  { id: 'u1', name: 'יוסי כהן', city: 'תל אביב', country: 'ישראל', score: 98, level: 8, isFriend: true },
  { id: 'u3', name: 'מיכל לוי', city: 'רמת גן', country: 'ישראל', score: 88, level: 4, isFriend: true },
  { id: 'u4', name: 'דניאל אברהם', city: 'תל אביב', country: 'ישראל', score: 99, level: 12, isFriend: false },
  { id: 'u5', name: 'אנה קנדריק', city: 'חיפה', country: 'ישראל', score: 100, level: 20, isFriend: false },
  { id: 'u6', name: 'רון ארד', city: 'ירושלים', country: 'ישראל', score: 91, level: 15, isFriend: false },
  { id: 'u7', name: 'שרה ישראלי', city: 'אילת', country: 'ישראל', score: 85, level: 3, isFriend: true },
  { id: 'u8', name: 'אבי לוי', city: 'תל אביב', country: 'ישראל', score: 92, level: 7, isFriend: false },
];

export function getMockData(path: string, method?: string): any {
  // 5.3.1.1 User Entity
  if (path.includes('/api/auth/login') || path.includes('/api/auth/register')) {
    // לצורכי הדגמה: אם האימייל מכיל 'admin', נחזיר משתמש מנהל
    const isAdmin = path.includes('admin%40carma.com') || path.includes('admin@carma.com');

    return {
      token: 'mock-token-123',
      user: {
        id: CURRENT_USER_ID,
        name: isAdmin ? 'מנהל מערכת (Admin)' : 'ישראל ישראלי',
        email: isAdmin ? 'admin@carma.com' : 'test@carma.com',
        role: isAdmin ? 'admin' : 'driver',
        points: isAdmin ? 99999 : 1250,
        level: isAdmin ? 99 : 5,
        rank: isAdmin ? 'System Administrator' : 'Safe Driver',
        city: 'תל אביב',
        country: 'ישראל'
      }
    };
  }

  // 5.3.1.2 Trip Entity
  if (path.includes('/api/trips')) {
    return {
      trips: [
        {
          id: 't1',
          user_id: CURRENT_USER_ID,
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 1800000).toISOString(),
          avg_score: 92,
          distance: 12.5,
          events_array: [],
          // שדות נוספים לתצוגה בפירוט נסיעה (Demo)
          durationSeconds: 1800,
          points: 150,
          hardBrakes: 1,
          aggressiveAccels: 0,
          sharpTurns: 2,
          phoneSeconds: 15
        },
        {
          id: 't2',
          user_id: CURRENT_USER_ID,
          start_time: new Date(Date.now() - 86400000).toISOString(),
          end_time: new Date(Date.now() - 86400000 + 1200000).toISOString(),
          avg_score: 85,
          distance: 8.2,
          events_array: [],
          // שדות נוספים לתצוגה בפירוט נסיעה (Demo)
          durationSeconds: 1200,
          points: 80,
          hardBrakes: 3,
          aggressiveAccels: 1,
          sharpTurns: 1,
          phoneSeconds: 0
        }
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
        { id: 'r1', business_name: 'Paz', title: '50 ש"ח הנחה בתדלוק', description: '50 ש"ח הנחה בתדלוק בכל תחנות פז', cost_points: 500, imageEmoji: '⛽', category: 'fuel' },
        { id: 'r2', business_name: 'Arcaffe', title: 'קפה ומאפה חינם', description: 'קפה ומאפה חינם בכל סניפי ארקפה', cost_points: 150, imageEmoji: '☕', category: 'food' },
        { id: 'r3', business_name: 'Lime', title: '15 דקות נסיעה בחינם', description: '15 דקות נסיעה בחינם בקורקינט חשמלי', cost_points: 300, imageEmoji: '🛴', category: 'eco' },
        { id: 'r4', business_name: 'Cinema City', title: 'כרטיס VIP לסרט', description: 'כרטיס כניסה למתחם ה-VIP בסינמה סיטי', cost_points: 1200, imageEmoji: '🎬', category: 'entertainment' },
        { id: 'r5', business_name: 'Super-Pharm', title: '20% הנחה על מוצרי טיפוח', description: 'קופון הנחה למחלקת הקוסמטיקה', cost_points: 400, imageEmoji: '🧴', category: 'shopping' }
      ],
      vouchers: []
    };
  }

  // 5.3.1.6 Leaderboard Logic (Dynamic Filtering)
  if (path.includes('/api/leaderboard')) {
    const url = new URL(path, 'http://localhost');
    const type = url.searchParams.get('type') || 'national';

    let filtered = [...ALL_USERS];
    const currentUser = ALL_USERS.find(u => u.id === CURRENT_USER_ID);

    if (type === 'friends') {
      filtered = ALL_USERS.filter(u => u.isFriend || u.id === CURRENT_USER_ID);
    } else if (type === 'city') {
      filtered = ALL_USERS.filter(u => u.city === currentUser?.city);
    }

    // מיון לפי ציון (גבוה לנמוך)
    filtered.sort((a, b) => b.score - a.score);

    // יצירת מבנה ה-Entry עם Rank מחושב
    const entries = filtered.map((u, index) => ({
      id: `entry-${u.id}`,
      user_id: u.id,
      rank: index + 1,
      score: u.score,
      user: {
        name: u.name,
        city: u.city,
        level: u.level
      }
    }));

    return {
      entries,
      currentUserId: CURRENT_USER_ID
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
