import React from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import type { IoniconName } from '@/constants/icons';

export interface SelectItem {
  key: string;
  label: string;
  icon?: IoniconName;
  iconColor?: string;
}

interface SelectSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: SelectItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

// Generic bottom-sheet picker, extracted out of LanguagePicker so a second
// "choose one of N" UI (the reward category picker) doesn't reinvent it.
export function SelectSheet({ visible, onClose, title, items, selectedKey, onSelect }: SelectSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.sheetTitle}>{title}</Text>

        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={items.length > 6}
          bounces={false}
        >
          {items.map((item, index) => {
            const isSelected = item.key === selectedKey;
            const isLast = index === items.length - 1;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.item, !isLast && styles.itemBorder]}
                onPress={() => onSelect(item.key)}
                activeOpacity={0.6}
              >
                <View style={styles.itemLeft}>
                  {item.icon && (
                    <Ionicons name={item.icon} size={18} color={item.iconColor ?? COLORS.textMuted} />
                  )}
                  <Text style={[styles.itemLabel, isSelected && styles.itemLabelActive]}>
                    {item.label}
                  </Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.brand} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.dark,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    paddingBottom: 32,
    maxHeight: '60%',
  },
  handle: {
    width: 36, height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetTitle: {
    ...COMMON_STYLES.sectionTitle,
    textAlign: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 0,
  },
  list: { paddingHorizontal: SPACING.lg },
  item: {
    ...COMMON_STYLES.rowBetween,
    paddingVertical: SPACING.md,
  },
  itemLeft:        { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  itemBorder:      { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  itemLabel:       { ...TYPOGRAPHY.body },
  itemLabelActive: { color: COLORS.brand, fontWeight: '700' },
});
