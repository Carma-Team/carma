import type { TranslationMap } from './types';

const en: TranslationMap = {
  app: { name: 'CARMA Business' },
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
  shell: {
    brandTag: 'Business',
    navGroupManagement: 'Management',
    navGroupUpcoming: 'Coming soon',
    navRewards: 'Rewards',
    navRedemption: 'Redemptions',
    navBusinessProfile: 'Business Profile',
    navTeam: 'Team & Permissions',
    navOverview: 'Overview',
    navAnalytics: 'Analytics',
    comingSoonBadge: 'Coming soon',
  },
  home: {
    title: 'Redeem a reward',
    subtitle: "This is your daily action — scan or enter a code to redeem a customer's reward.",
    redeemCta: 'Redeem a reward',
  },
  comingSoon: {
    title: 'Coming soon',
    message: "This page hasn't been built yet.",
  },
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
