import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { getLevelConfig } from '@/lib/constants'
import type { Language } from '@/types'

interface LevelBadgeProps {
  level: number
  size?: 'sm' | 'md' | 'lg'
  lang?: Language
  showName?: boolean
}

export function LevelBadge({ level, size = 'md', lang = 'he', showName }: LevelBadgeProps) {
  const config = getLevelConfig(level)
  const dim = { sm: 36, md: 48, lg: 64 }[size]
  const fontSize = { sm: 16, md: 22, lg: 30 }[size]

  return (
    <View style={styles.wrapper}>
      <View style={[styles.circle, { width: dim, height: dim, borderRadius: dim / 2, borderColor: config.color }]}>
        <Text style={{ fontSize }}>{config.icon}</Text>
      </View>
      {showName && (
        <Text style={[styles.name, { color: config.color }]}>
          {lang === 'he' ? config.name : config.nameEn}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  circle:  { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  name:    { fontSize: 11, fontWeight: '700', marginTop: 4 },
})

export default LevelBadge
