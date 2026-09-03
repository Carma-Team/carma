import React, { useState } from 'react'
import {
  Modal, View, Text, TouchableOpacity,
  FlatList, StyleSheet, StyleProp, ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { COLORS, TYPOGRAPHY } from '@/constants/theme'

/**
 * One choice. The label is what the reader sees; the value is what identifies it.
 *
 * They were once the same string, which meant callers had to resolve a pick back
 * through a label-keyed map — and two settlements whose names match in the active
 * language collapsed into one entry that resolved to whichever was built last
 * (CAR-290).
 */
export interface LocationOption {
  value: string
  label: string
}

interface LocationPickerProps {
  /** The selected option's `value`, not its label. Empty means nothing is picked. */
  value: string
  options: LocationOption[]
  placeholder: string
  onChange: (value: string) => void
  style?: StyleProp<ViewStyle>
}

export function LocationPicker({ value, options, placeholder, onChange, style }: LocationPickerProps) {
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={[styles.trigger, style]}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {selectedLabel || placeholder}
        </Text>
        {value ? (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
        <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={o => o.value}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const selected = item.value === value
                return (
                  <TouchableOpacity
                    style={[styles.option, selected && styles.optionActive]}
                    onPress={() => { onChange(item.value); setOpen(false) }}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                      {item.label}
                    </Text>
                    {selected && <Ionicons name="checkmark" size={16} color={COLORS.brand} />}
                  </TouchableOpacity>
                )
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
    minWidth: 0,
  },
  triggerText: { ...TYPOGRAPHY.caption, color: COLORS.text, flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    maxHeight: 320,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  optionActive: { backgroundColor: COLORS.dark },
  optionText: { ...TYPOGRAPHY.body, color: COLORS.text },
  optionTextActive: { color: COLORS.brand, fontWeight: '700' },
})
