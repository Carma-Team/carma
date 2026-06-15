import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { getUserLevelData } from '@/lib/constants';
import { localize } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { LevelConfig, Language } from '@/types';

interface RoadmapLevelItemProps {
  lvl: LevelConfig;
  idx: number;
  totalLevels: number;
  currentLevel: number;
  currentPoints: number;
  lang: Language;
}

export function RoadmapLevelItem({ lvl, idx, totalLevels, currentLevel, currentPoints, lang }: RoadmapLevelItemProps) {
  const { t } = useTranslation();

  const isCompleted = currentLevel > lvl.level;
  const isCurrent   = currentLevel === lvl.level;
  const isLocked    = currentLevel < lvl.level;

  const lineColor   = isCompleted ? lvl.color : COLORS.border;
  const bubbleColor = isLocked ? COLORS.border : lvl.color;
  const iconColor   = isLocked ? COLORS.textMuted : lvl.color;
  const bubbleBg    = isLocked
    ? COLORS.card
    : isCurrent
      ? lvl.color + '30'
      : lvl.color + '20';

  return (
    <View style={styles.levelRow}>
      {/* Left axis column: top-connector → bubble → bottom-connector */}
      <View style={styles.axisColumn}>
        {/* Line segment above bubble — hidden for the first item */}
        <View style={[styles.connectorTop, { backgroundColor: idx === 0 ? 'transparent' : lineColor }]} />

        {/* Icon bubble — rendered between the two line segments, always on top */}
        <View style={[styles.bubble, { borderColor: bubbleColor, backgroundColor: bubbleBg }]}>
          <Ionicons name={lvl.icon as any} size={18} color={iconColor} />
        </View>

        {/* Line segment below bubble — hidden for the last item */}
        <View style={[styles.connectorBottom, { backgroundColor: idx < totalLevels - 1 ? lineColor : 'transparent' }]} />
      </View>

      {/* Level card */}
      <Card
        style={[
          styles.levelCard,
          isCurrent ? { borderColor: lvl.color, borderWidth: 2 } : undefined,
          isLocked  ? { opacity: 0.5 } : undefined,
        ]}
        padding="sm"
      >
        <View style={styles.levelHeader}>
          <View>
            <Text style={styles.levelNum}>
              {t('common.level')} {lvl.level}
              {isCurrent && <Text style={[styles.currentTag, { color: lvl.color }]}> ← {t('roadmap.currentLevel')}</Text>}
            </Text>
            <Text style={[styles.levelName, { color: isLocked ? COLORS.textMuted : lvl.color }]}>
              {localize(lvl.name, lvl.nameEn, lang)}
            </Text>
          </View>
          <View style={styles.levelRight}>
            {isCompleted && <Ionicons name={ICONS.active} size={16} color={COLORS.success} />}
            {isLocked    && <Ionicons name={ICONS.locked} size={16} color={COLORS.textMuted} />}
            <Text style={styles.minPoints}>{lvl.minPoints.toLocaleString()}</Text>
          </View>
        </View>

        {lvl.perks.length > 0 && (
          <View style={styles.perks}>
            {lvl.perks.map(perk => (
              <View key={perk} style={styles.perkRow}>
                <Text style={styles.perkDot}>•</Text>
                <Text style={[styles.perkText, isLocked && { color: COLORS.textMuted }]}>{perk}</Text>
              </View>
            ))}
          </View>
        )}

        {isCurrent && currentLevel < 10 && (
          <View style={styles.progressRow}>
            <View style={{ paddingHorizontal: 15 }}>
              <Progress
                value={getUserLevelData(currentPoints).progress}
                color={lvl.color}
                height={5}
              />
            </View>
            <Text style={styles.progressLabel}>
              {currentPoints.toLocaleString()} / {lvl.maxPoints === Infinity ? '∞' : lvl.maxPoints.toLocaleString()}
            </Text>
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  levelRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 0,
  },

  // Left axis: fixed width, stretches to match card height
  axisColumn: {
    width: 44,
    alignItems: 'center',
    flexShrink: 0,
    marginEnd: 12,
  },
  connectorTop: {
    width: 2,
    height: 16,
  },
  bubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorBottom: {
    width: 2,
    flex: 1,
    minHeight: 8,
  },

  // Card
  levelCard:    { flex: 1, marginBottom: SPACING.sm },
  levelHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  levelNum:     { ...TYPOGRAPHY.caption, fontSize: 11, fontWeight: '600' },
  currentTag:   { fontSize: 11 },
  levelName:    { ...TYPOGRAPHY.h3, fontSize: 15, marginTop: 2 },
  levelRight:   { alignItems: 'flex-end', gap: 2 },
  minPoints:    { ...TYPOGRAPHY.caption, fontSize: 11 },
  perks:        { marginTop: 8, gap: 3 },
  perkRow:      { flexDirection: 'row', gap: 4 },
  perkDot:      { color: COLORS.textMuted, fontSize: 12 },
  perkText:     { color: COLORS.text, fontSize: 12, flex: 1 },
  progressRow:  { marginTop: 10, gap: 4 },
  progressLabel:{ ...TYPOGRAPHY.caption, fontSize: 10, textAlign: 'right' },
});
