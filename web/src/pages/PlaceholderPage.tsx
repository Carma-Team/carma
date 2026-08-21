import { useTranslation } from '@/hooks/useTranslation';
import { Card, Heading, Text, Button } from '@/components/ui';

// Proves routing, the shared UI foundation and the i18n/RTL infrastructure
// work end to end. Not the real business home page — that's CAR-204.
export function PlaceholderPage() {
  const { t, lang, setLang } = useTranslation();

  return (
    <main style={{ padding: 'var(--space-lg)' }}>
      <Card>
        <Heading level={1}>{t('app.name')}</Heading>
        <Heading level={2}>{t('placeholder.title')}</Heading>
        <Text>{t('placeholder.message')}</Text>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
          <Text as="span" variant="label">
            {t('language.label')}:
          </Text>
          <Button variant={lang === 'HE' ? 'primary' : 'secondary'} onClick={() => setLang('HE')}>
            {t('language.he')}
          </Button>
          <Button variant={lang === 'EN' ? 'primary' : 'secondary'} onClick={() => setLang('EN')}>
            {t('language.en')}
          </Button>
        </div>
      </Card>
    </main>
  );
}
