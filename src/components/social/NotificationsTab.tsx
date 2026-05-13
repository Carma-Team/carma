import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';

export function NotificationsTab() {
  const { t } = useTranslation();

  return (
    <Card style={COMMON_STYLES.emptyState}>
      <Text style={COMMON_STYLES.emptyIcon}>🔔</Text>
      <Text style={COMMON_STYLES.emptyText}>{t('profile.noNotifications') || 'אין הודעות חדשות'}</Text>
      <Text style={styles.emptySubtitle}>
        {t('profile.notificationsSubtitle') || 'כאן יופיעו עדכונים על מבצעים, ציונים והודעות מערכת.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  emptySubtitle: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    marginTop: 8
  },
});
