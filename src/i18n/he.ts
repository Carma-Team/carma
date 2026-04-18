const he = {
  app:   { name: 'CARMA', tagline: 'נהג חכם. קצור פרסים.' },
  nav: {
    dashboard: 'בית', trip: 'נסיעה', roadmap: 'מסלול',
    marketplace: 'חנות', leaderboard: 'דירוג', profile: 'פרופיל',
  },
  auth: {
    login: 'כניסה', register: 'הרשמה', logout: 'יציאה',
    email: 'אימייל', password: 'סיסמה', name: 'שם מלא',
    phone: 'טלפון', city: 'עיר', age: 'גיל', licenseYear: 'שנת קבלת רישיון',
    noAccount: 'אין לך חשבון?', hasAccount: 'יש לך חשבון?',
    loginBtn: 'היכנס', registerBtn: 'צור חשבון', guestLoginBtn: 'כניסה כאורח (לפיתוח)',
    emailPlaceholder: 'your@email.com', passwordPlaceholder: '••••••••',
    namePlaceholder: 'ישראל ישראלי',
    errors: {
      emailRequired: 'אנא הזן אימייל', passwordRequired: 'אנא הזן סיסמה',
      nameRequired: 'אנא הזן שם מלא', invalidEmail: 'אימייל לא תקין',
      passwordTooShort: 'הסיסמה קצרה מדי (מינימום 6 תווים)',
      emailExists: 'האימייל כבר קיים במערכת', invalidCredentials: 'אימייל או סיסמה שגויים',
    },
  },
  dashboard: {
    welcome: 'שלום', yourScore: 'הציון שלך', startTrip: 'התחל נסיעה',
    noTrips: 'עדיין אין נסיעות', noTripsDesc: 'התחל את הנסיעה הראשונה שלך!',
    recentTrips: 'נסיעות אחרונות', viewAll: 'הצג הכל',
    totalDistance: 'מרחק כולל', totalTrips: 'נסיעות',
    avgScore: 'ציון ממוצע', pointsToNextLevel: 'נקודות לרמה הבאה',
  },
  trip: {
    active: 'נסיעה פעילה', start: 'התחל נסיעה', end: 'סיים נסיעה',
    duration: 'משך', distance: 'מרחק', score: 'ציון', events: 'אירועים',
    hardBrakes: 'בלימות חדות', aggressiveAccels: 'האצות חדות',
    sharpTurns: 'פניות חדות', phoneTouches: 'נגיעות בטלפון',
    status: { excellent: 'מצוין!', good: 'טוב', fair: 'בסדר', poor: 'שפר' },
    trafficLight: { green: 'נסיעה מצוינת!', yellow: 'שים לב', red: 'נהיגה מסוכנת' },
    riskHourBonus: 'בונוס שעת סיכון', riskMultiplier: 'מכפיל סיכון',
    aiInsight: 'תובנת AI', summary: 'סיכום נסיעה',
    pointsEarned: 'נקודות שנצברו', simulationNote: 'סימולציה מדמה נסיעה',
  },
  roadmap: {
    title: 'מסלול ההתקדמות', subtitle: 'הדרך שלך לנהג המדגם',
    currentLevel: 'רמה נוכחית', nextLevel: 'רמה הבאה', progress: 'התקדמות',
    perks: 'הטבות', locked: 'נעול', unlocked: 'פתוח',
    pointsNeeded: 'נקודות נדרשות', completed: 'הושלם',
  },
  marketplace: {
    title: 'חנות הפרסים', subtitle: 'מימש את הנקודות שלך',
    myVouchers: 'השוברים שלי', allRewards: 'כל הפרסים', points: 'נקודות',
    redeem: 'ממש', redeemSuccess: 'הפרס מומש בהצלחה!',
    notEnoughPoints: 'אין מספיק נקודות', outOfStock: 'אזל מהמלאי', expires: 'תפוגה',
    categories: { all: 'הכל', fuel: 'דלק', food: 'אוכל', eco: 'ירוק', entertainment: 'בידור', shopping: 'קניות' },
    voucher: { title: 'השובר שלך', code: 'קוד', scanQR: 'סרוק QR', expiry: 'תפוגה', used: 'מומש', active: 'פעיל' },
    bonusDilemma: {
      title: 'בחר את הפרס שלך!', invest: 'השקע בנקודות', investDesc: 'שמור נקודות לפרס גדול יותר',
      redeem: 'מימש עכשיו', redeemDesc: 'קבל פרס מידי', cancel: 'ביטול',
    },
  },
  leaderboard: {
    title: 'טבלת המובילים', friends: 'חברים', city: 'עיר', national: 'ארצי',
    rank: 'מיקום', player: 'שחקן', score: 'ניקוד', you: 'אתה',
    noFriends: 'אין חברים עדיין',
  },
  profile: {
    title: 'הפרופיל שלי', stats: 'הישגים', chart: 'סטטיסטיקות', achievements: 'הישגים',
    tripHistory: 'היסטוריית נסיעות', notifications: 'הודעות', language: 'שפה',
    totalDistance: 'ק"מ', avgScore: 'ציון ממוצע', safeTrips: 'נסיעות בטוחות',
    level: 'רמה', joined: 'הצטרף', phone: 'טלפון', city: 'עיר', age: 'גיל',
    licenseYear: 'רישיון מ-', noTrips: 'עדיין אין נסיעות', totalDistance2: 'מרחק כולל',
    driveMode: 'מצב נסיעה אוטומטי',
  },
  stats: {
    scoreHistory: 'היסטוריית ציונים', totalDistance: 'מרחק כולל',
    totalTrips: 'סה"כ נסיעות', avgScore: 'ציון ממוצע', safeTrips: 'נסיעות בטוחות',
    totalPoints: 'נקודות שנצברו', totalDuration: 'זמן נהיגה', noData: 'אין נתונים',
  },
  common: {
    loading: 'טוען...', error: 'שגיאה', retry: 'נסה שוב', cancel: 'ביטול',
    confirm: 'אישור', close: 'סגור', save: 'שמור', back: 'חזור', next: 'הבא',
    done: 'סיום', points: 'נקודות', level: 'רמה', score: 'ציון', noData: 'אין נתונים',
    seeAll: 'ראה הכל',
  },
} as const

export type TranslationKeys = typeof he
export default he
