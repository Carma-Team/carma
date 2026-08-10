import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { getUserLevelData } from '@/lib/constants';
import { localize } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { LevelConfig, Language } from '@/types';

interface RoadmapHeroProps {
  userPoints: number;
  currentLevel: number;
  levelInfo: LevelConfig;
  lang: Language;
}

export function RoadmapHero({ userPoints, currentLevel, levelInfo, lang }: RoadmapHeroProps) {
  const { t } = useTranslation();
  const levelData = getUserLevelData(userPoints);

  return (
    <Card glass glow style={styles.hero}>
      <View style={[styles.heroIconCircle, { borderColor: levelData.config.color + '60', backgroundColor: levelData.config.color + '18' }]}>
        <Ionicons name={levelData.config.icon as any} size={40} color={levelData.config.color} />
      </View>
      <Text style={[styles.heroName, { color: levelData.config.color }]}>
        {localize(levelData.config.name, levelData.config.nameEn, lang)}
      </Text>
      <Text style={styles.heroPoints}>{userPoints.toLocaleString()} {t('common.points')}</Text>

      {!levelData.isMaxLevel && (
        <View style={styles.progressWrapper}>
          <Progress
            value={levelData.progress}
            color={levelData.config.color}
            height={8}
            showValue={false}
          />
          <Text style={styles.heroSub}>
            {t('roadmap.pointsToNextLine').replace('{points}', levelData.pointsToNext.toLocaleString())}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 28, marginBottom: SPACING.lg },
  heroIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  heroName: { fontSize: 22, fontWeight: '900' },
  heroPoints: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  progressWrapper: { width: '100%', paddingHorizontal: 25, marginTop: 10 },
  heroSub: { ...TYPOGRAPHY.caption, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
