import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/hooks/useTranslation';
import { COLORS, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';

interface DashboardHeaderProps {
  userName: string;
}

export function DashboardHeader({ userName }: DashboardHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const firstName = userName.split(' ')[0];

  return (
    <View style={COMMON_STYLES.rowBetween}>
      <View>
        <Text style={styles.welcome}>{t('dashboard.welcome')},</Text>
        <Text style={styles.name}>{firstName} 👋</Text>
      </View>
      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => router.push('/(home)/settings')}
      >
        <Text style={styles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: { ...TYPOGRAPHY.caption },
  name: { ...TYPOGRAPHY.h2, fontSize: 26 },
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
  settingsIcon: { fontSize: 18 },
});
