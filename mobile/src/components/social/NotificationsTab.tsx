import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS, SPACING } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { notificationsApi } from '@/services/api/notifications.api';
import type { Notification } from '@/types';

/** Renders the message for a notification from its type + payload — never from server text.
 *  `t` has no interpolation and returns the key itself when missing, so the
 *  placeholder is substituted here. */
function useNotificationText() {
  const { t } = useTranslation();
  return useCallback(
    (n: Notification): string => {
      switch (n.type) {
        case 'level_up':
          return t('notifications.levelUp').replace('{level}', String(n.payload.level));
        case 'follow_accepted':
          // The other user may have no name set — fall back to a nameless phrasing
          // rather than printing "null".
          return n.payload.userName
            ? t('notifications.followAccepted').replace('{name}', n.payload.userName)
            : t('notifications.followAcceptedAnon');
        case 'follow_requested':
          return n.payload.userName
            ? t('notifications.followRequested').replace('{name}', n.payload.userName)
            : t('notifications.followRequestedAnon');
      }
    },
    [t]
  );
}

/** Icon per kind — keeps the switch above about text only. */
function iconFor(n: Notification): 'trophy' | 'person-add' | 'person-circle' {
  switch (n.type) {
    case 'level_up':
      return 'trophy';
    case 'follow_accepted':
      return 'person-add';
    case 'follow_requested':
      return 'person-circle';
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function NotificationsTab() {
  const { t } = useTranslation();
  const renderText = useNotificationText();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    notificationsApi
      .list()
      .then(rows => {
        if (cancelled) return;
        setItems(rows);
        // Opening the tab is the read receipt. Fire-and-forget: a failed mark
        // only means the badge lingers, which must not blank the list.
        if (rows.some(r => r.readAt === null)) {
          notificationsApi.markAllRead().catch(e => console.error('Mark all read failed', e));
        }
      })
      .catch(e => console.error('Notifications error:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />;
  }

  if (items.length === 0) {
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

  return (
    <View style={styles.list}>
      {items.map(n => (
        <View key={n.id} style={styles.row}>
          <View style={styles.icon}>
            <Ionicons name={iconFor(n)} size={22} color={COLORS.brand} />
          </View>
          <View style={styles.info}>
            <Text style={styles.message}>{renderText(n)}</Text>
            <Text style={styles.when}>{formatWhen(n.createdAt)}</Text>
          </View>
          {n.readAt === null ? <View style={styles.unreadDot} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emptySubtitle: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    marginTop: 8
  },
  list: { paddingTop: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  icon: { width: 36, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  message: { ...TYPOGRAPHY.body, color: COLORS.text, flexWrap: 'wrap' },
  when: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.brand },
});
