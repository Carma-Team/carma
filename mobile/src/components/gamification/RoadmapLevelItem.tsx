import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { getUserLevelData } from '@/lib/constants';
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

  return (
    <View style={styles.levelRow}>
      {/* Connector line */}
      {idx < totalLevels - 1 && (
        <View style={[styles.connector, { backgroundColor: isCompleted ? lvl.color : COLORS.border }]} />
      )}

      {/* Icon bubble */}
      <View style={[
        styles.bubble,
        { borderColor: lvl.color },
        isCurrent   && { backgroundColor: lvl.color + '30' },
        isCompleted && { backgroundColor: lvl.color + '20' },
        isLocked    && { opacity: 0.4 },
      ]}>
        <Text style={styles.bubbleIcon}>{lvl.icon}</Text>
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
              {lang === 'he' ? lvl.name : lvl.nameEn}
            </Text>
          </View>
          <View style={styles.levelRight}>
            {isCompleted && <Text style={styles.checkmark}>✅</Text>}
            {isLocked    && <Text style={styles.lock}>🔒</Text>}
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
  levelRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  connector:    { position: 'absolute', left: 19, top: 48, width: 2, height: '100%', zIndex: 0 },
  bubble:       { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)', flexShrink: 0, marginTop: 4, zIndex: 1 },
  bubbleIcon:   { fontSize: 18 },
  levelCard:    { flex: 1 },
  levelHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  levelNum:     { ...TYPOGRAPHY.caption, fontSize: 11, fontWeight: '600' },
  currentTag:   { fontSize: 11 },
  levelName:    { ...TYPOGRAPHY.h3, fontSize: 15, marginTop: 2 },
  levelRight:   { alignItems: 'flex-end', gap: 2 },
  checkmark:    { fontSize: 16 },
  lock:         { fontSize: 16 },
  minPoints:    { ...TYPOGRAPHY.caption, fontSize: 11 },
  perks:        { marginTop: 8, gap: 3 },
  perkRow:      { flexDirection: 'row', gap: 4 },
  perkDot:      { color: COLORS.textMuted, fontSize: 12 },
  perkText:     { color: '#cbd5e1', fontSize: 12, flex: 1 },
  progressRow:  { marginTop: 10, gap: 4 },
  progressLabel:{ ...TYPOGRAPHY.caption, fontSize: 10, textAlign: 'right' },
});
