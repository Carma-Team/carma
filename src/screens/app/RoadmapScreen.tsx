import React from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { Card }       from '@/components/ui/Card'
import { Progress }   from '@/components/ui/Progress'
import { useApp }     from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { LEVELS, getLevelProgress, getPointsToNextLevel, COLORS } from '@/lib/constants'

export default function RoadmapScreen() {
  const { user } = useApp()
  const { t, lang } = useTranslation()

  if (!user) return null
  const currentLevel   = user.level
  const currentPoints  = user.totalPoints

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('roadmap.title')}</Text>
      <Text style={styles.subtitle}>{t('roadmap.subtitle')}</Text>

      {/* Current level hero */}
      <Card glass glow style={styles.hero}>
        <Text style={styles.heroIcon}>{LEVELS[currentLevel - 1].icon}</Text>
        <Text style={[styles.heroName, { color: LEVELS[currentLevel - 1].color }]}>
          {lang === 'he' ? LEVELS[currentLevel - 1].name : LEVELS[currentLevel - 1].nameEn}
        </Text>
        <Text style={styles.heroPoints}>{currentPoints.toLocaleString()} {t('common.points')}</Text>

        {currentLevel < 10 && (
          <>
            <Progress
              value={getLevelProgress(currentPoints, currentLevel)}
              color={LEVELS[currentLevel - 1].color}
              height={8}
            />
            <Text style={styles.heroSub}>
              עוד {getPointsToNextLevel(currentPoints, currentLevel).toLocaleString()} {t('common.points')} לרמה הבאה
            </Text>
          </>
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
                    <Progress
                      value={getLevelProgress(currentPoints, currentLevel)}
                      color={lvl.color}
                      height={5}
                    />
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
  )
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  content:      { padding: 16, paddingBottom: 100 },
  heading:      { color: '#fff', fontSize: 24, fontWeight: '900' },
  subtitle:     { color: COLORS.textMuted, fontSize: 13, marginBottom: 16 },
  hero:         { alignItems: 'center', gap: 8, paddingVertical: 28, marginBottom: 24 },
  heroIcon:     { fontSize: 56 },
  heroName:     { fontSize: 22, fontWeight: '900' },
  heroPoints:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  heroSub:      { color: COLORS.textMuted, fontSize: 12 },
  levels:       { gap: 0 },
  levelRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  connector:    { position: 'absolute', left: 19, top: 48, width: 2, height: '100%', zIndex: 0 },
  bubble:       { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)', flexShrink: 0, marginTop: 4, zIndex: 1 },
  bubbleIcon:   { fontSize: 18 },
  levelCard:    { flex: 1 },
  levelHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  levelNum:     { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  currentTag:   { fontSize: 11 },
  levelName:    { fontSize: 15, fontWeight: '700', marginTop: 2 },
  levelRight:   { alignItems: 'flex-end', gap: 2 },
  checkmark:    { fontSize: 16 },
  lock:         { fontSize: 16 },
  minPoints:    { color: COLORS.textMuted, fontSize: 11 },
  perks:        { marginTop: 8, gap: 3 },
  perkRow:      { flexDirection: 'row', gap: 4 },
  perkDot:      { color: COLORS.textMuted, fontSize: 12 },
  perkText:     { color: '#cbd5e1', fontSize: 12, flex: 1 },
  progressRow:  { marginTop: 10, gap: 4 },
  progressLabel:{ color: COLORS.textMuted, fontSize: 10, textAlign: 'right' },
})
