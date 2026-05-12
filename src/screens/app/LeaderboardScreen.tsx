import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '@/context/AppContext'
import { LeaderboardTabs } from '@/components/social/LeaderboardTabs'
import { LeaderboardList } from '@/components/social/LeaderboardList'
import { useTranslation } from '@/hooks/useTranslation'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme'
import type { LeaderboardEntry, LeaderboardType } from '@/navigation/types'

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const { user } = useApp()
  const [type,          setType]          = useState<LeaderboardType>('national')
  const [entries,       setEntries]       = useState<LeaderboardEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    setLoading(true)
    leaderboardApi.get(type)
      .then(data => {
        setEntries(data.entries)
        setCurrentUserId(data.currentUserId)
      })
      .catch(err => console.error('Leaderboard error:', err))
      .finally(() => setLoading(false))
  }, [type])

  const tabs: { key: LeaderboardType; label: string }[] = [
    { key: 'friends',  label: t('leaderboard.friends') },
    { key: 'city',     label: t('leaderboard.city') },
    { key: 'national', label: t('leaderboard.national') },
  ]

  return (
    <View style={[COMMON_STYLES.screen, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={COMMON_STYLES.scrollContent}>
        <Text style={styles.heading}>{t('leaderboard.title')}</Text>

        <LeaderboardTabs
          activeTab={type}
          onTabChange={setType}
          tabs={tabs}
        />

        <View style={{ height: 20 }} />

        {type !== 'friends' && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.filterSubtitle}>
              {type === 'city'
                ? `${t('leaderboard.showing_city')}: ${user?.city || 'תל אביב'}`
                : `${t('leaderboard.showing_national')}: ${user?.country || 'ישראל'}`
              }
            </Text>
          </View>
        )}

        <LeaderboardList
          entries={entries}
          loading={loading}
          currentUserId={currentUserId}
        />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  heading:      { ...TYPOGRAPHY.h2, marginBottom: SPACING.lg },
  filterSubtitle: {
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    color: COLORS.textMuted,
  },
})
