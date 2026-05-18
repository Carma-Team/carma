import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { levelToEmoji } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import type { LeaderboardEntry } from '@/types'

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
  row:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm },
  highlighted:      { backgroundColor: COLORS.brand + '15' }, // 15% opacity
  rank:             { width: 35, ...TYPOGRAPHY.body, fontWeight: '700', textAlign: 'center' },
  avatar:           { fontSize: 24 },
  info:             { flex: 1 },
  name:             { color: COLORS.text, ...TYPOGRAPHY.body, fontWeight: '600' },
  nameHighlighted:  { color: COLORS.brandLight },
  city:             { color: COLORS.text, fontSize: 12, opacity: 0.7 },
  score:            { color: COLORS.warning, fontWeight: '700', fontSize: 16 },
})

export default LeaderboardRow
