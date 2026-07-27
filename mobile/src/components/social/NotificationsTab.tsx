import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS, SPACING } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { notificationsApi } from '@/services/api/notifications.api';
import type { Notification } from '@/types';

type RenderedNotification = { text: string; icon: 'trophy' | 'person-add' | 'person-circle' };

/** Describes a notification from its type + payload — never from server text.
 *
 *  Returns null for a kind this build does not know about. That is not a
 *  theoretical branch: `type` is a plain varchar server-side precisely so a new
 *  kind ships without a migration, and store rollout leaves installed apps weeks
 *  behind the server. The union below is exhaustive as *declared*, so TypeScript
 *  cannot help here — the value arrives at runtime. Unknown rows are skipped by
 *  the caller rather than rendered blank.
 *
 *  `t` has no interpolation and returns the key itself when missing, so
 *  placeholders are substituted here. */
function useDescribeNotification() {
  const { t } = useTranslation();
  return useCallback(
    (n: Notification): RenderedNotification | null => {
      switch (n.type) {
        case 'level_up':
          return {
            text: t('notifications.levelUp').replace('{level}', String(n.payload.level)),
            icon: 'trophy',
          };
        case 'follow_accepted':
          // The other user may have no name set — fall back to a nameless phrasing
          // rather than printing "null".
          return {
            text: n.payload.userName
              ? t('notifications.followAccepted').replace('{name}', n.payload.userName)
              : t('notifications.followAcceptedAnon'),
            icon: 'person-add',
          };
        case 'follow_requested':
          return {
            text: n.payload.userName
              ? t('notifications.followRequested').replace('{name}', n.payload.userName)
              : t('notifications.followRequestedAnon'),
            icon: 'person-circle',
          };
        default:
          return null;
      }
    },
    [t]
  );
}

/** Formats the timestamp in the app's language, not the device's.
 *
 *  Today's notifications show a time — without it everything from today
 *  collapsed onto one indistinguishable date. Older ones keep the date. */
function formatWhen(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const locale = lang === 'he' ? 'he-IL' : 'en-US';
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  return isToday
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale);
}

export function NotificationsTab() {
  const { t, lang } = useTranslation();
  const describe = useDescribeNotification();
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

  // Drop kinds this build cannot describe. Checked before the empty state so a
  // page of nothing but unknown kinds reads as "no notifications" rather than a
  // blank list.
  const visible = items
    .map(n => ({ n, rendered: describe(n) }))
    .filter((row): row is { n: Notification; rendered: RenderedNotification } => row.rendered !== null);

  if (visible.length === 0) {
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
      {visible.map(({ n, rendered }) => (
        <View key={n.id} style={styles.row}>
          <View style={styles.icon}>
            <Ionicons name={rendered.icon} size={22} color={COLORS.brand} />
          </View>
          <View style={styles.info}>
            <Text style={styles.message}>{rendered.text}</Text>
            <Text style={styles.when}>{formatWhen(n.createdAt, lang)}</Text>
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
