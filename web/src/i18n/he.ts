import type { TranslationMap } from './types';

const he: TranslationMap = {
  app: { name: 'כרמה עסקים' },
  common: {
    loading: 'טוען…',
    errorTitle: 'משהו השתבש',
    errorMessage: 'נסו שוב.',
    retry: 'נסה שוב',
    emptyTitle: 'אין כאן עדיין כלום',
    emptyMessage: 'אין נתונים להצגה.',
  },
  language: { label: 'שפה', he: 'עברית', en: 'English' },
  notFound: { title: 'הדף לא נמצא', message: 'הדף שחיפשת לא קיים.' },
  shell: {
    brandTag: 'Business',
    navGroupManagement: 'ניהול',
    navGroupUpcoming: 'בקרוב',
    navRewards: 'הטבות',
    navRedemption: 'מימושים',
    navBusinessProfile: 'פרטי העסק',
    navTeam: 'צוות והרשאות',
    navOverview: 'סקירה כללית',
    navAnalytics: 'אנליטיקס',
    comingSoonBadge: 'בקרוב',
  },
  home: {
    title: 'מימוש הטבה',
    subtitle: 'זו הפעולה היומית שלכם — סרקו או הזינו קוד כדי לממש הטבה ללקוח.',
    redeemCta: 'מימוש הטבה',
  },
  comingSoon: {
    title: 'בקרוב',
    message: 'העמוד הזה עדיין לא נבנה.',
  },
  auth: {
    signInTitle: 'התחברות',
    emailLabel: 'אימייל',
    passwordLabel: 'סיסמה',
    signInButton: 'התחברות',
    signingIn: 'מתחבר…',
    invalidCredentials: 'אימייל או סיסמה שגויים.',
    signOutButton: 'התנתקות',
  },
};

export default he;
