import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, TYPOGRAPHY, COMMON_STYLES } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import { TripSummaryView } from '@/components/driving/TripSummaryView';
import type { TripSummary } from '@/lib/tripSummary';

interface TripSummaryModalProps {
  visible: boolean;
  onClose: () => void;
  summary: TripSummary | null;
  onViewDetails?: (id: string) => void;
}

export function TripSummaryModal({ visible, onClose, summary, onViewDetails }: TripSummaryModalProps) {
  const { t } = useTranslation();

  if (!summary) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={COMMON_STYLES.modalOverlay}>
        <Card style={styles.summaryCard}>
          {/* The buttons that close this sit below the fold, and the card gives no
              sign it scrolls — so the exit has to be visible without scrolling. */}
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel={t('trip.close')}
            hitSlop={10}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          {summary.state === 'tooShort' ? (
            <View style={{ alignItems: 'center' }}>
              <TripSummaryView summary={summary} />
              <Button fullWidth size="xl" onPress={onClose} textStyle={{ textAlign: 'center' }} style={{ marginTop: 10 }}>
                {t('trip.gotIt')}
              </Button>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.summaryTitle}>{t('trip.tripCompleted')}</Text>

                <TripSummaryView summary={summary} />

                {summary.id && onViewDetails && (
                  <Button
                    fullWidth
                    variant="outline"
                    onPress={() => onViewDetails(summary.id!)}
                    style={{ marginTop: 24 }}
                  >
                    {t('trip.viewFullDetails')}
                  </Button>
                )}

                <Button fullWidth onPress={onClose} style={{ marginTop: 12, marginBottom: 10 }}>
                  {t('trip.closeAndHome')}
                </Button>
              </View>
            </ScrollView>
          )}
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    paddingHorizontal: 20,
    paddingVertical: 25,
    alignItems: 'center',
    width: '94%',
    maxHeight: '92%',
    borderRadius: 35,
    backgroundColor: COLORS.dark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle: { ...TYPOGRAPHY.h2, fontSize: 26, marginBottom: SPACING.md },
  // `start`, not `left` — the card's own direction decides which corner this is,
  // and the X belongs opposite the text, on the leading edge.
  closeBtn: {
    position: 'absolute', top: 12, start: 12, zIndex: 2,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.card,
  },
});
