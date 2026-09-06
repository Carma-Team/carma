import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { levelToIcon } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { cityLabel } from '@/lib/cityLabel'
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme'
import type { FollowStatus, LeaderboardEntry } from '@/types'

interface LeaderboardRowProps {
  entry: LeaderboardEntry
  isCurrentUser: boolean
  showFollowButton?: boolean
  onFollow?: (userId: string, currentStatus: FollowStatus) => void
  showRemoveButton?: boolean
  onRemove?: () => void
}

const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: '#9ca3af', 3: '#b45309' }

const LEVEL_COLORS = ['#6b7280','#6b7280','#3b82f6','#3b82f6','#f59e0b','#f97316','#22c55e','#8b5cf6','#f59e0b','#fbbf24']

function levelColor(level: number): string {
  return LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)]
}

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
  showRemoveButton = false,
  onRemove,
}: LeaderboardRowProps) {
  const { t, lang } = useTranslation()
  const rankColor = RANK_COLORS[entry.rank]
  const followStatus: FollowStatus = entry.followStatus ?? 'none'

  return (
    <View style={[styles.row, isCurrentUser && styles.highlighted]}>
      <Text style={[styles.rank, rankColor ? { color: rankColor, fontWeight: '900' } : null]}>
        {entry.rank}
      </Text>
      <View style={styles.avatar}>
        <Ionicons name={levelToIcon(entry.user?.level ?? 1) as any} size={22} color={levelColor(entry.user?.level ?? 1)} />
      </View>
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
        {entry.user?.city && <Text style={styles.city}>{cityLabel(entry.user.city, lang)}</Text>}
      </View>
      <Text style={styles.score}>{entry.score.toLocaleString()}</Text>

      {showFollowButton && !isCurrentUser && followStatus !== 'blocked' && (
        <FollowButton
          status={followStatus}
          onPress={() => onFollow?.(entry.userId, followStatus)}
        />
      )}
      {showRemoveButton && !isCurrentUser && (
        <TouchableOpacity
          onPress={onRemove}
          style={styles.removeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="remove" size={15} color={COLORS.danger} />
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm },
  highlighted:     { backgroundColor: COLORS.brand + '15' },
  rank:            { width: 35, ...TYPOGRAPHY.body, fontWeight: '700', textAlign: 'center' },
  avatar:          { width: 30, alignItems: 'center', justifyContent: 'center' },
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
  removeBtn:       { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.danger, backgroundColor: 'transparent' },
})

export default LeaderboardRow
