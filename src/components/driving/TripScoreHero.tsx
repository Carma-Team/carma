import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SPACING } from '@/constants/theme';
import { scoreToGrade, scoreToColor } from '@/lib/scoring';
import { formatDate, scoreToEmoji } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface TripScoreHeroProps {
  score: number;
  date: string | Date;
  lang: string;
}

export function TripScoreHero({ score, date, lang }: TripScoreHeroProps) {
  const { t } = useTranslation();
  const grade = scoreToGrade(score);
  const color = scoreToColor(score);
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any;

  return (
    <Card glass glow style={styles.hero}>
      <Text style={styles.heroEmoji}>{scoreToEmoji(score)}</Text>
      <Text style={[styles.heroScore, { color }]}>{Math.round(score)}</Text>
      <Badge variant={badgeVariant}>{t(`trip.status.${grade}`)}</Badge>
      <Text style={styles.heroDate}>{formatDate(date, lang)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 32, marginBottom: SPACING.md },
  heroEmoji: { fontSize: 52 },
  heroScore: { fontSize: 64, fontWeight: '900' },
  heroDate: { color: '#94a3b8', fontSize: 13 },
});
