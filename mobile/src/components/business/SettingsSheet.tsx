import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { ICONS } from '@/constants/icons';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import type { Language } from '@/types';

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  lang: Language;
  onSelectLang: (lang: Language) => void;
  languageLabel: string;
  onLogout: () => void;
  logoutLabel: string;
}

// Centered dialog that fades in over a dimmed backdrop — RN's own
// animationType="fade" on the Modal covers the transition, no custom
// Animated.timing needed.
export function SettingsSheet({
  visible, onClose, title, lang, onSelectLang, languageLabel, onLogout, logoutLabel,
}: SettingsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.card}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Ionicons name="close" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <Text style={styles.title}>{title}</Text>

          <View style={styles.row}>
            <LanguagePicker lang={lang} onSelect={onSelectLang} buttonLabel={languageLabel} />

            <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
              <Ionicons name={ICONS.logout} size={20} color={COLORS.danger} />
              <Text style={styles.logoutText}>{logoutLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    width: '85%',
    backgroundColor: COLORS.dark,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 40,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  closeBtn: {
    position: 'absolute',
    top: 12, left: 12,
  },
  title: { ...TYPOGRAPHY.h3, textAlign: 'center', marginBottom: SPACING.lg },
  row: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  // Same capsule shape as LanguagePicker's trigger, so the two buttons carry
  // equal visual weight and their centers — not just their boxes — line up.
  logoutBtn: {
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
  logoutText: { fontSize: 13, fontWeight: '600', color: COLORS.danger },
});
