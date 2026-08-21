export type Language = 'HE' | 'EN';

export type LanguageContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
};

export type TranslationMap = {
  app: {
    name: string;
  };
  placeholder: {
    title: string;
    message: string;
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
};
