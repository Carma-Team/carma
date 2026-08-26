import { useTranslation } from '@/hooks/useTranslation';
import { ErrorState } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main style={{ padding: 'var(--space-lg)' }}>
      <ErrorState title={t('notFound.title')} message={t('notFound.message')} />
    </main>
  );
}
