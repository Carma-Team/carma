import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, Heading, Text, Button } from '@/components/ui';

// Deliberately thin — no dashboard statistics (CAR-119). Its one job is to
// put the daily action (voucher redemption) one click away; the redemption
// route itself is CAR-68 and renders ComingSoonPage until that lands.
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card>
      <Heading level={1}>{t('home.title')}</Heading>
      <Text variant="body">{t('home.subtitle')}</Text>
      <div style={{ marginTop: 'var(--space-md)' }}>
        <Button variant="primary" onClick={() => navigate('/redemption')}>
          {t('home.redeemCta')}
        </Button>
      </div>
    </Card>
  );
}
