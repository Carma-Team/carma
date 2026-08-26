import { useTranslation } from '@/hooks/useTranslation';
import { EmptyState } from '@/components/ui';

// Stands in for every core route whose own ticket hasn't landed yet (CAR-202,
// business profile, …) so CAR-204's route structure is stable now and later
// tickets replace this without touching the shell. No feature-specific logic
// — see docs/business-portal-design/README.md.
export function ComingSoonPage() {
  const { t } = useTranslation();
  return <EmptyState title={t('comingSoon.title')} message={t('comingSoon.message')} />;
}
