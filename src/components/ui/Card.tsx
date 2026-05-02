import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { COLORS } from '@/theme'

interface CardProps {
  children: React.ReactNode
  glass?: boolean
  glow?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  style?: ViewStyle
  onPress?: () => void
}

export function Card({ children, glass, glow, padding = 'md', style }: CardProps) {
  const paddingValue = { none: 0, sm: 10, md: 16, lg: 24 }[padding]

  return (
    <View
      style={[
        styles.base,
        glass ? styles.glass : styles.solid,
        glow && styles.glow,
        { padding: paddingValue },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  base:  { borderRadius: 16, borderWidth: 1 },
  solid: { backgroundColor: COLORS.card, borderColor: COLORS.border },
  glass: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' },
  glow:  { shadowColor: COLORS.brand, shadowOpacity: 0.15, shadowRadius: 12, elevation: 4 },
})

export default Card
