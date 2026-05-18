import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { getUserLevelData } from '@/lib/constants';
import { useTranslation } from '@/hooks/useTranslation';
import type { LevelConfig } from '@/types';

interface RoadmapHeroProps {
  userPoints: number;
  currentLevel: number;
  levelInfo: LevelConfig;
  lang: string;
}

export function RoadmapHero({ userPoints, currentLevel, levelInfo, lang }: RoadmapHeroProps) {
  const { t } = useTranslation();
  const levelData = getUserLevelData(userPoints);

  return (
    <Card glass glow style={styles.hero}>
      <Text style={styles.heroIcon}>{levelData.config.icon}</Text>
      <Text style={[styles.heroName, { color: levelData.config.color }]}>
        {lang === 'he' ? levelData.config.name : levelData.config.nameEn}
      </Text>
      <Text style={styles.heroPoints}>{userPoints.toLocaleString()} {t('common.points')}</Text>

      {!levelData.isMaxLevel && (
        <View style={styles.progressWrapper}>
          <Progress
            value={levelData.progress}
            color={levelData.config.color}
            height={8}
          />
          <Text style={styles.heroSub}>
            עוד {levelData.pointsToNext.toLocaleString()} {t('common.points')} לרמה הבאה
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 28, marginBottom: SPACING.lg },
  heroIcon: { fontSize: 56 },
  heroName: { fontSize: 22, fontWeight: '900' },
  heroPoints: { color: '#fff', fontSize: 16, fontWeight: '700' },
  progressWrapper: { width: '100%', paddingHorizontal: 25, marginTop: 10 },
  heroSub: { ...TYPOGRAPHY.caption, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
