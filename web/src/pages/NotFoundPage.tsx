import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();

  // No <main> here — this only ever renders inside AppShell (see router.tsx),
  // which already owns the page's one <main> landmark.
  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <ErrorState title={t('notFound.title')} message={t('notFound.message')} />
    </div>
  );
}
