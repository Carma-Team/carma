import React from 'react'
import {
  TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle,
} from 'react-native'
import { COLORS } from '@/constants/theme'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size    = 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  disabled?: boolean
  onPress?: () => void
  children: React.ReactNode
  style?: ViewStyle
  textStyle?: TextStyle
}

const variantStyle: Record<Variant, ViewStyle & { color?: string }> = {
  primary:   { backgroundColor: COLORS.brand },
  secondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  ghost:     { backgroundColor: 'transparent' },
  danger:    { backgroundColor: COLORS.danger },
  outline:   { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.brand },
}

const sizeStyle: Record<Size, { padding: ViewStyle; text: TextStyle }> = {
  sm: { padding: { paddingHorizontal: 12, paddingVertical: 6  }, text: { fontSize: 13 } },
  md: { padding: { paddingHorizontal: 16, paddingVertical: 10 }, text: { fontSize: 14 } },
  lg: { padding: { paddingHorizontal: 24, paddingVertical: 14 }, text: { fontSize: 16 } },
  xl: { padding: { paddingHorizontal: 32, paddingVertical: 18 }, text: { fontSize: 18 } },
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  fullWidth,
  disabled,
  onPress,
  children,
  style,
  textStyle
}: ButtonProps) {
  const vStyle = variantStyle[variant]
  const sStyle = sizeStyle[size]
  const isDisabled = disabled || loading
  // One ink for the label and the spinner. The theme is light, so a white
  // spinner is invisible on every variant that is not a filled one.
  const ink =
    variant === 'primary' || variant === 'danger' ? '#ffffff'
      : variant === 'outline' ? COLORS.brand
        : COLORS.text

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.base,
        vStyle,
        sStyle.padding,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={ink} size="small" />
        : <Text
            style={[
              styles.text,
              sStyle.text,
              fullWidth && { flex: 1 },
              { color: ink },
              textStyle
            ]}
            numberOfLines={1}
          >
            {children}
          </Text>
      }
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  fullWidth: { width: '100%' },
  disabled:  { opacity: 0.5 },
  text:      { color: COLORS.text, fontWeight: '600', textAlign: 'center' },
})

export default Button
