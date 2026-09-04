import React from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp }     from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { LEVELS, getLevelByPoints } from '@/lib/constants'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import { LevelWheel } from '@/components/gamification/LevelWheel'
import { WeekScoreStrip } from '@/components/social/WeekScoreStrip'

/**
 * Roadmap screen — shows the score trend and all gamification levels.
 * Trips come from AppContext rather than a fetch of its own: the context list is
 * the one the driver's deletions have been applied to, and a screen that calls the
 * endpoint directly would keep counting trips they removed from their history.
 * The level list needs no server call either — user.points and user.level are
 * loaded at login.
 */
export default function RoadmapScreen() {
  const insets = useSafeAreaInsets()
  const { user, recentTrips } = useApp()
  const { t, lang } = useTranslation()

  if (!user) return null

  // Safe level calculation: fall back to points-derived level if user.level is missing. Clamp to [1, 10].
  const currentPoints  = user.points || 0
  const calculatedLevel = getLevelByPoints(currentPoints)
  const currentLevel   = Math.min(10, Math.max(1, user.level || calculatedLevel))

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <View style={[COMMON_STYLES.rowBetween, { paddingHorizontal: SPACING.md, marginTop: SPACING.md, marginBottom: SPACING.sm }]}>
        <View>
          <Text style={styles.heading}>{t('roadmap.title')}</Text>
          <Text style={styles.subtitle}>{t('roadmap.subtitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.root} contentContainerStyle={COMMON_STYLES.scrollContent}>
        {/* This week's daily scores */}
        <WeekScoreStrip trips={recentTrips} lang={lang} />

        {/* Level wheel — drag through all levels, info card follows whichever is centered */}
        <View style={styles.levels}>
          <LevelWheel
            levels={LEVELS}
            currentLevel={currentLevel}
            currentPoints={currentPoints}
            lang={lang}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  heading:      { ...TYPOGRAPHY.h2 },
  subtitle:     { ...TYPOGRAPHY.caption, marginBottom: 4 },
  levels:       { gap: 0 },
})
