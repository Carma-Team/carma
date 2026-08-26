export type Language = 'HE' | 'EN';

export type LanguageContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
};

export type TranslationMap = {
  app: {
    name: string;
  };
  common: {
    loading: string;
    errorTitle: string;
    errorMessage: string;
    retry: string;
    emptyTitle: string;
    emptyMessage: string;
  };
  language: {
    label: string;
    he: string;
    en: string;
  };
  notFound: {
    title: string;
    message: string;
  };
  shell: {
    brandTag: string;
    navGroupManagement: string;
    navGroupUpcoming: string;
    navRewards: string;
    navRedemption: string;
    navBusinessProfile: string;
    navTeam: string;
    navOverview: string;
    navAnalytics: string;
    comingSoonBadge: string;
  };
  home: {
    title: string;
    subtitle: string;
    redeemCta: string;
  };
  comingSoon: {
    title: string;
    message: string;
  };
  auth: {
    signInTitle: string;
    emailLabel: string;
    passwordLabel: string;
    signInButton: string;
    signingIn: string;
    invalidCredentials: string;
    signOutButton: string;
  };
};
