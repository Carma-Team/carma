import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { LevelBadge } from '@/components/gamification/LevelBadge';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { getLevelConfig } from '@/lib/constants';
import { formatDistance, formatDate } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Language } from '@/types';

interface ProfileHeaderProps {
  user: {
    name?: string;
    city?: string;
    level: number;
    totalPoints: number;
    totalDistance?: number;
    createdAt?: string;
  };
  lang: Language;
}

export function ProfileHeader({ user, lang }: ProfileHeaderProps) {
  const { t } = useTranslation();
  const currentLevel = Math.max(1, user.level || 1);
  const levelConfig = getLevelConfig(currentLevel);

  const stats = [
    { label: t('profile.totalDistance'), value: formatDistance(user.totalDistance || 0, lang) },
    { label: t('profile.level'),         value: String(currentLevel) },
    { label: t('profile.joined'),        value: user.createdAt ? formatDate(user.createdAt, lang) : '—' },
  ];

  return (
    <Card glass style={styles.container}>
      <View style={styles.row}>
        <LevelBadge level={currentLevel} size="lg" lang={lang} />
        <View style={styles.info}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.city}>{user.city}</Text>
          <Text style={[styles.levelText, { color: levelConfig.color }]}>
            {levelConfig.icon} {lang === 'he' ? levelConfig.name : levelConfig.nameEn}
          </Text>
        </View>
        <View style={styles.pointsWrapper}>
          <Text style={styles.pointsValue}>{(user.totalPoints || 0).toLocaleString()}</Text>
          <Text style={styles.pointsLabel}>{t('common.points')}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        {stats.map(s => (
          <View key={s.label} style={styles.statItem}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  info: { flex: 1 },
  name: { ...TYPOGRAPHY.h3, fontSize: 18 },
  city: { ...TYPOGRAPHY.caption },
  levelText: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  pointsWrapper: { alignItems: 'flex-end' },
  pointsValue: { color: COLORS.brandLight, fontSize: 22, fontWeight: '900' },
  pointsLabel: { ...TYPOGRAPHY.caption, fontSize: 11 },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 12, paddingTop: 12 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: '#fff', fontWeight: '700', fontSize: 14 },
  statLabel: { ...TYPOGRAPHY.caption, fontSize: 11, marginTop: 2 },
});
