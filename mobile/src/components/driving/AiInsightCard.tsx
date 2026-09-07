import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { useTranslation } from '@/hooks/useTranslation';

interface AiInsightCardProps {
  text: string;
}

/** One server-generated coaching sentence for a scored trip (app/services/insights.py). */
export function AiInsightCard({ text }: AiInsightCardProps) {
  const { t } = useTranslation();

  return (
    <View style={[COMMON_STYLES.card, styles.card]}>
      <View style={styles.header}>
        <Ionicons name={ICONS.aiInsight} size={16} color={COLORS.brand} />
        <Text style={styles.label}>{t('trip.aiInsight')}</Text>
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:   { marginTop: SPACING.md, alignSelf: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  label:  { ...TYPOGRAPHY.label, color: COLORS.brand },
  text:   { ...TYPOGRAPHY.body },
});
