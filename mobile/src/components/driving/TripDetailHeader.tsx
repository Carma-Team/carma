import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { formatDate } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface TripDetailHeaderProps {
  onBack?: () => void;
  date?: string | Date;
  /** Later trip — up, the direction a newer trip sits in a date-ordered list. */
  onNewer?: () => void;
  /** Earlier trip — down. */
  onOlder?: () => void;
  hasNewer?: boolean;
  hasOlder?: boolean;
}

export function TripDetailHeader({
  onBack, date, onNewer, onOlder, hasNewer, hasOlder,
}: TripDetailHeaderProps) {
  const { t, lang } = useTranslation();
  const router = useRouter();

  const handleBack = onBack || (() => router.back());
  const showNav = Boolean(onNewer || onOlder);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.back}>
        <Text style={styles.backText}>← {t('common.back')}</Text>
      </TouchableOpacity>

      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={TYPOGRAPHY.h2}>{t('trip.summary')}</Text>
          {date && (
            <Text style={styles.date}>
              {formatDate(typeof date === 'string' ? date : date.toISOString(), lang)}
            </Text>
          )}
        </View>

        {/* Vertical rather than left/right: the horizontal pair would have to mean
            opposite things in Hebrew and English, while newer-is-up matches how the
            trip list is ordered in both. */}
        {showNav && (
          <View style={styles.nav}>
            <NavButton
              icon="chevron-up"
              enabled={Boolean(hasNewer)}
              onPress={onNewer}
              label={t('trip.newerTrip')}
            />
            <NavButton
              icon="chevron-down"
              enabled={Boolean(hasOlder)}
              onPress={onOlder}
              label={t('trip.olderTrip')}
            />
          </View>
        )}
      </View>
    </View>
  );
}

function NavButton({
  icon, enabled, onPress, label,
}: {
  icon: 'chevron-up' | 'chevron-down';
  enabled: boolean;
  onPress?: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={[styles.navBtn, !enabled && styles.navBtnDisabled]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={enabled ? COLORS.brandLight : COLORS.textMuted}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Gap between the header and whatever the screen puts below it — raise this to
  // push the gauge further down, lower it to pull the gauge up.
  container: { marginBottom: SPACING.sm },
  back: { marginBottom: 8 },
  backText: { color: COLORS.brandLight, fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleBlock: { flex: 1 },
  date: { ...TYPOGRAPHY.caption, fontSize: 12, marginTop: 2 },
  nav: { gap: 6 },
  navBtn: {
    width: 34,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.4 },
});
