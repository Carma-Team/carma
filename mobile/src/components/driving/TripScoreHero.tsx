import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SPACING, COLORS } from '@/constants/theme';
import { scoreToGrade, scoreToColor } from '@/lib/scoring';
import { formatDate, scoreToIcon } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Language } from '@/types';

interface TripScoreHeroProps {
  score: number;
  date: string | Date;
  lang: Language;
}

export function TripScoreHero({ score, date, lang }: TripScoreHeroProps) {
  const { t } = useTranslation();
  const grade = scoreToGrade(score);
  const color = scoreToColor(score);
  const badgeVariant = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' }[grade] as any;

  return (
    <Card glass glow style={styles.hero}>
      <Ionicons name={scoreToIcon(score) as any} size={56} color={color} />
      <Text style={[styles.heroScore, { color }]}>{Math.round(score)}</Text>
      <Badge variant={badgeVariant}>{t(`trip.status.${grade}`)}</Badge>
      <Text style={styles.heroDate}>{formatDate(typeof date === 'string' ? date : date.toISOString(), lang)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero:      { alignItems: 'center', gap: 8, paddingVertical: 32, marginBottom: SPACING.md },
  heroScore: { fontSize: 64, fontWeight: '900' },
  heroDate:  { color: COLORS.textMuted, fontSize: 13 },
});
