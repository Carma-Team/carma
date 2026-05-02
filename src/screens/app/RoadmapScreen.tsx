import React from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card }       from '@/components/ui/Card'
import { Progress }   from '@/components/ui/Progress'
import { useApp }     from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { LEVELS, getLevelProgress, getPointsToNextLevel, getLevelByPoints } from '@/lib/constants'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/theme'

export default function RoadmapScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useApp()
  const { t, lang } = useTranslation()

  if (!user) return null

  // חישוב רמה בטוח: אם אין רמה למשתמש, נחשב לפי נקודות. מינימום 1, מקסימום 10.
  const currentPoints  = user.points || 0
  const calculatedLevel = getLevelByPoints(currentPoints)
  const currentLevel   = Math.min(10, Math.max(1, user.level || calculatedLevel))

  // הגנה סופית: אם האינדקס לא קיים, ניקח את הרמה הראשונה
  const levelInfo = LEVELS[currentLevel - 1] || LEVELS[0]

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <View style={[COMMON_STYLES.rowBetween, { paddingHorizontal: SPACING.md, marginTop: SPACING.md, marginBottom: SPACING.sm }]}>
        <View>
          <Text style={styles.heading}>{t('roadmap.title')}</Text>
          <Text style={styles.subtitle}>{t('roadmap.subtitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>

        {/* Current level hero */}
        <Card glass glow style={styles.hero}>
          <Text style={styles.heroIcon}>{levelInfo.icon}</Text>
          <Text style={[styles.heroName, { color: levelInfo.color }]}>
            {lang === 'he' ? levelInfo.name : levelInfo.nameEn}
          </Text>
          <Text style={styles.heroPoints}>{currentPoints.toLocaleString()} {t('common.points')}</Text>

          {currentLevel < 10 && (
            <View style={{ width: '100%', paddingHorizontal: 25 }}>
              <Progress
                value={getLevelProgress(currentPoints, currentLevel)}
                color={levelInfo.color}
                height={8}
              />
              <Text style={styles.heroSub}>
                עוד {getPointsToNextLevel(currentPoints, currentLevel).toLocaleString()} {t('common.points')} לרמה הבאה
              </Text>
            </View>
          )}
        </Card>

        {/* All levels */}
        <View style={styles.levels}>
          {LEVELS.map((lvl, idx) => {
            const isCompleted = currentLevel > lvl.level
            const isCurrent   = currentLevel === lvl.level
            const isLocked    = currentLevel < lvl.level

            return (
              <View key={lvl.level} style={styles.levelRow}>
                {/* Connector line */}
                {idx < LEVELS.length - 1 && (
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
                    isCurrent && { borderColor: lvl.color, borderWidth: 2 },
                    isLocked  && { opacity: 0.5 },
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
                          value={getLevelProgress(currentPoints, currentLevel)}
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
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  heading:      { ...TYPOGRAPHY.h2 },
  subtitle:     { ...TYPOGRAPHY.caption, marginBottom: 4 },
  hero:         { alignItems: 'center', gap: 8, paddingVertical: 28, marginBottom: SPACING.lg },
  heroIcon:     { fontSize: 56 },
  heroName:     { fontSize: 22, fontWeight: '900' },
  heroPoints:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  heroSub:      { ...TYPOGRAPHY.caption, fontSize: 12 },
  levels:       { gap: 0 },
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
})
