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
};

export default en;
