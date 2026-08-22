import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';

interface DashboardHeaderProps {
  userName: string;
  currentStreak: number | null;
  bestStreak: number | null;
}

export function DashboardHeader({ userName, currentStreak, bestStreak }: DashboardHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const firstName = userName.split(' ')[0];

  return (
    <View style={COMMON_STYLES.rowBetween}>
      <View>
        <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
        <Text style={styles.name}>{firstName}</Text>
      </View>
      <View style={styles.actions}>
        <View
          style={styles.streakBadge}
          accessibilityLabel={`${t('stats.currentStreak')}: ${currentStreak ?? '--'}. ${t('stats.bestStreak')}: ${bestStreak ?? '--'}`}
        >
          <Ionicons name={ICONS.streak} size={16} color={COLORS.text} />
          <Text style={styles.streakValue}>{currentStreak ?? '--'}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(home)/friend-requests')}
        >
          <Ionicons name={ICONS.friendRequests} size={18} color={COLORS.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(home)/notifications')}
        >
          <Ionicons name={ICONS.notifications} size={18} color={COLORS.text} />
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
