import type { TranslationMap } from './types';

const he: TranslationMap = {
  app: { name: 'כרמה עסקים' },
  placeholder: {
    title: 'תשתית האתר פעילה',
    message: 'הדף הזה מוודא שהניתוב, המבנה הבסיסי והתרגומים מחוברים כראוי.',
  },
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
