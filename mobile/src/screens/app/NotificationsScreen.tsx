import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COMMON_STYLES, TYPOGRAPHY, COLORS, SPACING } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { notificationsApi } from '@/services/api/notifications.api';
import { friendsApi } from '@/services/api/friends.api';
import {
  bannerKey,
  hasUnread,
  initialState,
  loadFailed,
  loaded,
  markAllFailed,
  markFailed,
  markedAllRead,
  markedRead,
  tapActionFor,
  visibleRows,
  type NotificationsState,
} from '@/lib/notifications';
import type { Language, Notification } from '@/types';

/** Formats in the app's language, not the device's. Today shows a time —
 *  without it everything from today collapses onto one indistinguishable date. */
function formatWhen(iso: string, lang: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const locale = lang === 'HE' ? 'he-IL' : 'en-US';
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  return isToday
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale);
}

/**
 * Updates screen — was the "notifications" tab inside the now-retired Profile screen.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useTranslation();
  const [state, setState] = useState<NotificationsState>(initialState);
  const [pendingRequesterIds, setPendingRequesterIds] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await notificationsApi.list();
      setState(loaded(rows));
      // Only decides whether a request row navigates. A failure here must not
      // fail the screen — the rows still render, taps just do not route.
      try {
        const { requests } = await friendsApi.getIncoming();
        setPendingRequesterIds(new Set(requests.map(r => r.fromUserId)));
      } catch {
        setPendingRequesterIds(new Set());
      }
    } catch (e) {
      console.error('Notifications load failed', e);
      setState(prev => loadFailed(prev));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening the screen no longer marks everything read — that is an explicit action now.
  const handleTap = useCallback(
    async (n: Notification) => {
      const action = tapActionFor(n, pendingRequesterIds);

      if (n.readAt === null) {
        setBusyId(n.id);
        try {
          await notificationsApi.markRead(n.id);
          setState(prev => markedRead(prev, n.id, new Date().toISOString()));
        } catch (e) {
          console.error('Mark read failed', e);
          setState(prev => markFailed(prev)); // stays unread — never show success early
          return;
        } finally {
          setBusyId(null);
        }
      }

      if (action === 'open-friend-requests') router.push('/(home)/friend-requests');
    },
    [pendingRequesterIds, router]
  );

  const handleMarkAll = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();
      setState(prev => markedAllRead(prev, new Date().toISOString()));
    } catch (e) {
      console.error('Mark all read failed', e);
      setState(prev => markAllFailed(prev)); // nothing moves; the button stays available
    }
  }, []);

  const banner = state.banner ? (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{t(bannerKey(state.banner))}</Text>
      <TouchableOpacity onPress={() => void load()} accessibilityRole="button">
        <Text style={styles.retry}>{t('notifications.retry')}</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  const rows = visibleRows(state.items, t);

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={COMMON_STYLES.screenHeader}>
        <TouchableOpacity onPress={() => router.back()} style={COMMON_STYLES.screenHeaderBackBtn}>
          <Ionicons name={lang === 'HE' ? 'arrow-forward' : 'arrow-back'} size={28} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={COMMON_STYLES.screenHeaderTitle}>{t('profile.updatesTitle')}</Text>
      </View>

      {state.status === 'loading' ? (
        <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
      ) : state.status === 'error' ? (
        // A failed first load must never read as "you have no notifications".
        <Card style={COMMON_STYLES.emptyState}>{banner}</Card>
      ) : rows.length === 0 ? (
        <Card style={COMMON_STYLES.emptyState}>
          {banner}
          <Ionicons name={ICONS.noNotifs} size={40} color={COLORS.textMuted} style={{ marginBottom: 8 }} />
          <Text style={COMMON_STYLES.emptyText}>{t('profile.noNotifications')}</Text>
          <Text style={styles.emptySubtitle}>{t('profile.notificationsSubtitle')}</Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {banner}
          {hasUnread(state.items) ? (
            <TouchableOpacity onPress={() => void handleMarkAll()} style={styles.markAll} accessibilityRole="button">
              <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
            </TouchableOpacity>
          ) : null}

          {rows.map(({ notification, view }) => (
            <TouchableOpacity
              key={notification.id}
              style={styles.row}
              onPress={() => void handleTap(notification)}
              disabled={busyId === notification.id}
              accessibilityRole="button"
            >
              <View style={styles.icon}>
                <Ionicons name={view.icon} size={22} color={COLORS.brand} />
              </View>
              <View style={styles.info}>
                <Text style={styles.message}>{view.text}</Text>
                <Text style={styles.when}>{formatWhen(notification.createdAt, lang)}</Text>
              </View>
              {notification.readAt === null ? <View style={styles.unreadDot} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  bannerText: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, flex: 1 },
  retry: { ...TYPOGRAPHY.caption, color: COLORS.brand, fontWeight: '700' },
  markAll: { alignSelf: 'flex-end', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  markAllText: { ...TYPOGRAPHY.caption, color: COLORS.brand, fontWeight: '700' },
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
