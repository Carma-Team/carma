import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { levelToEmoji } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import type { LeaderboardEntry } from '@/navigation/types'

interface LeaderboardRowProps {
  entry: LeaderboardEntry
  isCurrentUser: boolean
}

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

export function LeaderboardRow({ entry, isCurrentUser }: LeaderboardRowProps) {
  const { t } = useTranslation()
  const medal = RANK_MEDALS[entry.rank]

  return (
    <View style={[styles.row, isCurrentUser && styles.highlighted]}>
      <Text style={styles.rank}>{medal ?? `#${entry.rank}`}</Text>
      <Text style={styles.avatar}>{levelToEmoji(entry.user?.level ?? 1)}</Text>
      <View style={styles.info}>
        <Text style={[styles.name, isCurrentUser && styles.nameHighlighted]}>
          {entry.user?.name ?? '—'} {isCurrentUser && `(${t('leaderboard.you')})`}
        </Text>
        {entry.user?.city && <Text style={styles.city}>{entry.user.city}</Text>}
      </View>
      <Text style={styles.score}>{entry.score.toLocaleString()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  highlighted:      { backgroundColor: 'rgba(99,102,241,0.08)' },
  rank:             { width: 32, fontSize: 18, textAlign: 'center' },
  avatar:           { fontSize: 22 },
  info:             { flex: 1 },
  name:             { color: '#fff', fontWeight: '600', fontSize: 14 },
  nameHighlighted:  { color: '#818cf8' },
  city:             { color: '#94a3b8', fontSize: 12 },
  score:            { color: '#f59e0b', fontWeight: '700', fontSize: 15 },
})

export default LeaderboardRow
