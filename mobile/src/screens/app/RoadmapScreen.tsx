import React from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp }     from '@/context/AppContext'
import { useTranslation } from '@/hooks/useTranslation'
import { LEVELS, getLevelByPoints } from '@/lib/constants'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import { RoadmapHero } from '@/components/gamification/RoadmapHero'
import { RoadmapLevelItem } from '@/components/gamification/RoadmapLevelItem'

/**
 * Roadmap screen — shows all gamification levels and the user's progress.
 * [server] No server calls — all data comes from AppContext (user.points, user.level)
 * loaded at login. The LEVELS list is statically defined in constants.
 */
export default function RoadmapScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useApp()
  const { t, lang } = useTranslation()

  if (!user) return null

  // Safe level calculation: fall back to points-derived level if user.level is missing. Clamp to [1, 10].
  const currentPoints  = user.points || 0
  const calculatedLevel = getLevelByPoints(currentPoints)
  const currentLevel   = Math.min(10, Math.max(1, user.level || calculatedLevel))

  // Final guard: if the index doesn't exist, fall back to the first level
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
        <RoadmapHero
          userPoints={currentPoints}
          currentLevel={currentLevel}
          levelInfo={levelInfo}
          lang={lang}
        />

        {/* All levels */}
        <View style={styles.levels}>
          {LEVELS.map((lvl, idx) => (
            <RoadmapLevelItem
              key={lvl.level}
              lvl={lvl}
              idx={idx}
              totalLevels={LEVELS.length}
              currentLevel={currentLevel}
              currentPoints={currentPoints}
              lang={lang}
            />
          ))}
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
