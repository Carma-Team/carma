import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';

interface DashboardHeaderProps {
  userName: string;
  currentStreak: number | null;
  bestStreak: number | null;
  /** Incoming friend requests still waiting on an answer. */
  pendingRequests: number;
  /** Notifications with no readAt. */
  unreadNotifications: number;
}

export function DashboardHeader({
  userName, currentStreak, bestStreak, pendingRequests, unreadNotifications,
}: DashboardHeaderProps) {
  const { t } = useTranslation();
  const { addToast } = useApp();
  const router = useRouter();
  const firstName = userName.split(' ')[0];

  return (
    <View style={COMMON_STYLES.rowBetween}>
      <View>
        <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
        <Text style={styles.name}>{firstName}</Text>
      </View>
      <View style={styles.actions}>
        {/* The flame and its number said nothing about what they counted. A toast
            rather than a screen: one sentence is the whole answer, and a route for it
            would be a screen nobody visits twice. */}
        <TouchableOpacity
          style={styles.streakBadge}
          onPress={() => addToast({ type: 'info', title: t('stats.currentStreak'), message: t('stats.streakInfo') })}
          accessibilityLabel={`${t('stats.currentStreak')}: ${currentStreak ?? '--'}. ${t('stats.bestStreak')}: ${bestStreak ?? '--'}`}
        >
          <Ionicons name={ICONS.streak} size={16} color={COLORS.text} />
          <Text style={styles.streakValue}>{currentStreak ?? '--'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(home)/friend-requests')}
          accessibilityLabel={withCount(t('profile.friendsTitle'), pendingRequests)}
        >
          <Ionicons name={ICONS.friendRequests} size={18} color={COLORS.text} />
          <CountBadge count={pendingRequests} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(home)/notifications')}
          accessibilityLabel={withCount(t('profile.updatesTitle'), unreadNotifications)}
        >
          <Ionicons name={ICONS.notifications} size={18} color={COLORS.text} />
          <CountBadge count={unreadNotifications} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(home)/settings')}
        >
          <Ionicons name={ICONS.settings} size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** The count is only announced when there is one, so the button does not read as
 *  "Notifications, 0" to a screen reader on an empty inbox. */
const withCount = (label: string, count: number) =>
  count > 0 ? `${label}: ${count}` : label;

/** Waiting-count over the corner of an icon button. Renders nothing below one, so a
 *  cleared inbox leaves no dot behind. */
function CountBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <View style={styles.badge}>
      {/* Past two digits the pill would outgrow the button it sits on, and the exact
          number stops carrying information long before that. */}
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: { ...TYPOGRAPHY.caption },
  name: { ...TYPOGRAPHY.h2, fontSize: 26 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 40,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  streakValue: { ...TYPOGRAPHY.caption, fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: -5,
    // `end`, not `right`: this is the one place in the row that has to move to the
    // other corner in Hebrew, and end/start is what mirrors on its own.
    end: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    // Separates the pill from the button edge it overlaps, which otherwise read as
    // one shape against the card background.
    borderWidth: 1.5,
    borderColor: COLORS.dark,
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  settingsBtn: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
