import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import type { Language } from '@/types';

export interface SupportedLanguage {
  code: Language;
  label: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'HE', label: 'עברית' },
  { code: 'EN', label: 'English' },
];

interface LanguagePickerProps {
  lang: Language;
  onSelect: (lang: Language) => void;
  buttonLabel?: string;
}

export function LanguagePicker({ lang, onSelect, buttonLabel = 'שפה' }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(code: Language) {
    onSelect(code);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.trigger}>
        <Ionicons name={ICONS.globe} size={16} color={COLORS.brandLight} />
        <Text style={styles.triggerText}>{buttonLabel}</Text>
        <Ionicons name="chevron-down" size={12} color={COLORS.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.sheetTitle}>{buttonLabel}</Text>

          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={SUPPORTED_LANGUAGES.length > 6}
            bounces={false}
          >
            {SUPPORTED_LANGUAGES.map((item, index) => {
              const isSelected = item.code === lang;
              const isLast = index === SUPPORTED_LANGUAGES.length - 1;
              return (
                <TouchableOpacity
                  key={item.code}
                  style={[styles.item, !isLast && styles.itemBorder]}
                  onPress={() => handleSelect(item.code)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.itemLabel, isSelected && styles.itemLabelActive]}>
                    {item.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.brand} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  triggerText: { ...TYPOGRAPHY.label, fontSize: 13, color: COLORS.brandLight },
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
  itemBorder:      { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  itemLabel:       { ...TYPOGRAPHY.body },
  itemLabelActive: { color: COLORS.brand, fontWeight: '700' },
});
