import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';

export function NotificationsTab() {
  const { t } = useTranslation();

  return (
    <Card style={COMMON_STYLES.emptyState}>
      <Ionicons name={ICONS.noNotifs} size={40} color={COLORS.textMuted} style={{ marginBottom: 8 }} />
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
