import type { TranslationMap } from './types';

const en: TranslationMap = {
  app: { name: 'CARMA Business' },
  placeholder: {
    title: 'Web foundation is running',
    message: 'This route confirms that routing, layout and translations are wired up.',
  },
  common: {
    loading: 'Loading…',
    errorTitle: 'Something went wrong',
    errorMessage: 'Please try again.',
    retry: 'Retry',
    emptyTitle: 'Nothing here yet',
    emptyMessage: 'There is no data to show.',
  },
  language: { label: 'Language', he: 'עברית', en: 'English' },
  notFound: { title: 'Page not found', message: "The page you're looking for doesn't exist." },
  auth: {
    signInTitle: 'Sign in',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    signInButton: 'Sign in',
    signingIn: 'Signing in…',
    invalidCredentials: 'Invalid email or password.',
    signOutButton: 'Sign out',
  },
};

export default en;
