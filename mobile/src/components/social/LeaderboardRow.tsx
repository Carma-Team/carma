import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { levelToEmoji } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import type { FollowStatus, LeaderboardEntry } from '@/types'

interface LeaderboardRowProps {
  entry: LeaderboardEntry
  isCurrentUser: boolean
  showFollowButton?: boolean
  onFollow?: (userId: string, currentStatus: FollowStatus) => void
}

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

function FollowButton({
  status,
  onPress,
}: {
  status: FollowStatus
  onPress: () => void
}) {
  if (status === 'blocked') return null

  const config: Record<Exclude<FollowStatus, 'blocked'>, { icon: string; style: object; iconColor: string }> = {
    none:     { icon: 'add',           style: styles.btnFollow,   iconColor: '#fff' },
    pending:  { icon: 'time-outline',  style: styles.btnPending,  iconColor: COLORS.warning },
    accepted: { icon: 'checkmark',     style: styles.btnAccepted, iconColor: COLORS.brand },
  }

  const { icon, style, iconColor } = config[status]

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.followBtn, style]}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name={icon as any} size={15} color={iconColor} />
    </TouchableOpacity>
  )
}

export function LeaderboardRow({
  entry,
  isCurrentUser,
  showFollowButton = false,
  onFollow,
}: LeaderboardRowProps) {
  const { t } = useTranslation()
  const medal = RANK_MEDALS[entry.rank]
  const followStatus: FollowStatus = entry.followStatus ?? 'none'

  return (
    <View style={[styles.row, isCurrentUser && styles.highlighted]}>
      <Text style={styles.rank}>{medal ?? `#${entry.rank}`}</Text>
      <Text style={styles.avatar}>{levelToEmoji(entry.user?.level ?? 1)}</Text>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, isCurrentUser && styles.nameHighlighted]} numberOfLines={1}>
            {entry.user?.name ?? '—'}
          </Text>
          {entry.user?.isPrivate && (
            <Ionicons name="lock-closed" size={11} color={COLORS.textMuted} style={styles.lockIcon} />
          )}
          {isCurrentUser && (
            <Text style={styles.youLabel}> ({t('leaderboard.you')})</Text>
          )}
        </View>
        {entry.user?.city && <Text style={styles.city}>{entry.user.city}</Text>}
      </View>
      <Text style={styles.score}>{entry.score.toLocaleString()}</Text>

      {showFollowButton && !isCurrentUser && followStatus !== 'blocked' && (
        <FollowButton
          status={followStatus}
          onPress={() => onFollow?.(entry.userId, followStatus)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm },
  highlighted:     { backgroundColor: COLORS.brand + '15' },
  rank:            { width: 35, ...TYPOGRAPHY.body, fontWeight: '700', textAlign: 'center' },
  avatar:          { fontSize: 24 },
  info:            { flex: 1, minWidth: 0 },
  nameRow:         { flexDirection: 'row', alignItems: 'center' },
  name:            { ...TYPOGRAPHY.body, color: COLORS.text, fontWeight: '600', flexShrink: 1 },
  nameHighlighted: { color: COLORS.brandLight },
  lockIcon:        { marginStart: 4 },
  youLabel:        { ...TYPOGRAPHY.caption, color: COLORS.textMuted },
  city:            { color: COLORS.text, fontSize: 12, opacity: 0.7 },
  score:           { color: COLORS.warning, fontWeight: '700', fontSize: 16 },
  followBtn:       { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnFollow:       { backgroundColor: COLORS.brand },
  btnPending:      { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.warning },
  btnAccepted:     { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.brand },
})

export default LeaderboardRow
