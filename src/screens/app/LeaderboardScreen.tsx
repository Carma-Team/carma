import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Card } from '@/components/ui/Card'
import { LeaderboardRow } from '@/components/social/LeaderboardRow'
import { useTranslation } from '@/hooks/useTranslation'
import { leaderboardApi } from '@/lib/api'
import { COLORS } from '@/lib/constants'
import type { LeaderboardEntry, LeaderboardType } from '@/navigation/types'

export default function LeaderboardScreen() {
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
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t('leaderboard.title')}</Text>

      <View style={styles.tabs}>
        {tabs.map(tab => (
          <TouchableOpacity key={tab.key} onPress={() => setType(tab.key)} style={[styles.tab, type === tab.key && styles.tabActive]}>
            <Text style={[styles.tabText, type === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <ActivityIndicator color={COLORS.brand} style={{ marginTop: 40 }} />
        : entries.length === 0
          ? <Card style={styles.empty}><Text style={styles.emptyIcon}>👥</Text><Text style={styles.emptyText}>{t('leaderboard.noFriends')}</Text></Card>
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
  )
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.dark },
  content:      { padding: 16, paddingBottom: 100 },
  heading:      { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 16 },
  tabs:         { flexDirection: 'row', backgroundColor: COLORS.card, borderRadius: 12, padding: 4, gap: 4, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  tab:          { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabActive:    { backgroundColor: COLORS.brand },
  tabText:      { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  tabTextActive:{ color: '#fff' },
  divider:      { height: 1, backgroundColor: COLORS.border },
  empty:        { alignItems: 'center', paddingVertical: 40 },
  emptyIcon:    { fontSize: 40, marginBottom: 8 },
  emptyText:    { color: COLORS.textMuted },
})
