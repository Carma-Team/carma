import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { LevelBadge } from './LevelBadge';
import { COLORS, TYPOGRAPHY, SPACING, COMMON_STYLES } from '@/constants/theme';
import { levelTheme } from '@/constants/icons';
import { getUserLevelData } from '@/lib/constants';
import { scoreToColor } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Language } from '@/types';

interface DashboardHeroProps {
  user: {
    level: number;
    points?: number;
    totalPoints: number;
  };
  driverScore: number;
  /**
   * The server always returns a score — a driver with no measured trips gets the
   * fleet prior instead of null — so this is what separates an earned score from
   * an assumed one. Also false while the stats request is still in flight, so a
   * placeholder never resolves into a number the driver did not earn.
   */
  hasMeasuredHistory: boolean;
  lang: Language;
}

export function DashboardHero({ user, driverScore, hasMeasuredHistory, lang }: DashboardHeroProps) {
  const { t } = useTranslation();
  const currentPoints = user.totalPoints;
  const levelData = getUserLevelData(currentPoints);

  return (
    <Card glass glow style={styles.hero}>
      <View style={[COMMON_STYLES.row, { gap: 0 }]}>
        <View style={styles.badgeWrapper}>
          <LevelBadge level={levelData.currentLevel} size="lg" lang={lang} showName />
        </View>

        <View style={styles.heroRight}>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: hasMeasuredHistory ? scoreToColor(driverScore) : COLORS.textMuted }]}>
              {hasMeasuredHistory ? driverScore : '--'}
            </Text>
            <Text style={styles.scoreSub}>{t('dashboard.yourScore')}</Text>
          </View>

          <View style={styles.progressContainer}>
            <Progress
              value={levelData.progress}
              color={levelTheme(levelData.currentLevel).color}
              height={6}
              showValue={false}
            />
            <View style={styles.progressStatsRow}>
              <Text style={styles.progressPointsText}>
                {currentPoints.toLocaleString()} {t('common.points')}
              </Text>
              {!levelData.isMaxLevel && (
                <Text style={styles.progressPointsText}>
                  {levelData.pointsToNext} {t('dashboard.pointsToNextLevel')}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginBottom: SPACING.md,
    marginTop: 15,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 0.2,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  badgeWrapper: {
    // Empirically flipped under this screen's RTL `direction` — marginLeft is the
    // gap toward the hero's right edge, marginRight toward the score on its left.
    marginLeft: 2,
    marginRight: 18,
    transform: [{ scale: 1.0 }]
  },
  heroRight: { flex: 1, justifyContent: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 8 },
  score: { fontSize: 48, fontWeight: '900' },
  scoreSub: { ...TYPOGRAPHY.caption, fontSize: 13 },
  progressContainer: { marginHorizontal: 4 },
  progressStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4
  },
  progressPointsText: { ...TYPOGRAPHY.caption, fontSize: 10, color: COLORS.text },
});
