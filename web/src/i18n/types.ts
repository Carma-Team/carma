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
  redemption: {
    title: string;
    subtitle: string;
    codeLabel: string;
    codePlaceholder: string;
    checkButton: string;
    checkingLabel: string;
    statusPending: string;
    statusUsed: string;
    statusExpired: string;
    statusCancelled: string;
    costPointsLabel: string;
    expiresLabel: string;
    timeRemainingLabel: string;
    expiredLabel: string;
    redeemButton: string;
    notRedeemableMessage: string;
    backToEntry: string;
    confirmTitle: string;
    confirmBody: string;
    confirmYes: string;
    confirmCancel: string;
    confirmCloseLabel: string;
    successTitle: string;
    successSubtitle: string;
    redeemAnotherButton: string;
    backToHomeButton: string;
    codeFormatError: string;
    redeemedAtLabel: string;
    retryAfterLabel: string;
    tryAnotherCodeButton: string;
    failureNotValidTitle: string;
    failureNotValidMessage: string;
    failureAlreadyUsedTitle: string;
    failureAlreadyUsedMessage: string;
    failureExpiredTitle: string;
    failureExpiredMessage: string;
    failureRateLimitedTitle: string;
    failureRateLimitedMessage: string;
    failureNetworkTitle: string;
    failureNetworkMessage: string;
    failureUnexpectedTitle: string;
    failureUnexpectedMessage: string;
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
