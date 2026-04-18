import React from 'react'
import { View, StyleSheet, Text } from 'react-native'
import { COLORS } from '@/lib/constants'

interface ProgressProps {
  value: number   // 0–100
  color?: string
  height?: number
  showValue?: boolean
}

export function Progress({ value, color = COLORS.brand, height = 12, showValue = true }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <View style={styles.container}>
      <View style={[styles.track, { height }]}>
        {/* We use a visible background for the "empty" part */}
        <View style={[styles.emptyTrack, { height, backgroundColor: '#334155' }]} />

        {/* The "filled" part */}
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: color,
              height,
              position: 'absolute',
              left: 0,
              top: 0,
            }
          ]}
        />
      </View>
      {showValue && (
        <Text style={styles.valueText}>{clamped}%</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: 4 },
  track: {
    width: '100%',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1e293b', // Deep dark background
  },
  emptyTrack: {
    width: '100%',
  },
  fill:  {
    borderRadius: 6,
    zIndex: 2,
  },
  valueText: {
    color: '#94a3b8',
    fontSize: 10,
    textAlign: 'right',
    fontWeight: '700'
  }
})

export default Progress
