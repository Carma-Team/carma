import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card } from '@/components/ui/Card'
import { LeaderboardRow } from '@/components/social/LeaderboardRow'
import { useTranslation } from '@/hooks/useTranslation'
import { leaderboardApi } from '@/services/api/leaderboard.api'
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/lib/constants'
import type { LeaderboardEntry, LeaderboardType } from '@/navigation/types'

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const [type,          setType]          = useState<LeaderboardType>('national')
  const [entries,       setEntries]       = useState<LeaderboardEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    setLoading(true)
    leaderboardApi.get(type)
      .then(data => { setEntries(data.entries); setCurrentUserId(data.currentUserId) })
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

        <View style={styles.tabs}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setType(tab.key)}
              style={[COMMON_STYLES.tab, type === tab.key && COMMON_STYLES.tabActive]}
            >
              <Text style={[COMMON_STYLES.tabText, type === tab.key && COMMON_STYLES.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading
          ? <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
          : entries.length === 0
            ? <Card style={COMMON_STYLES.emptyState}>
                <Text style={COMMON_STYLES.emptyIcon}>👥</Text>
                <Text style={COMMON_STYLES.emptyText}>{t('leaderboard.noFriends')}</Text>
              </Card>
            : <Card padding="none" style={{ overflow: 'hidden' }}>
                {entries.map((entry, i) => (
                  <View key={entry.id}>
                    {i > 0 && <View style={styles.divider} />}
                    <LeaderboardRow entry={entry} isCurrentUser={entry.userId === currentUserId} />
                  </View>
                ))}
              </Card>
        }
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  heading:      { ...TYPOGRAPHY.h2, marginBottom: SPACING.md },
  tabs:         { ...COMMON_STYLES.tabsContainer, marginBottom: SPACING.md }, // שימוש ב-Token הכללי עם מרווח ספציפי למסך
  divider:      { height: 1, backgroundColor: COLORS.border },
})
