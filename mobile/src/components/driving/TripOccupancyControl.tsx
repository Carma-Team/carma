/**
 * @file TripOccupancyControl.tsx
 * @owner May (Mobile & Frontend UI Lead)
 * @brief Lets a driver say they rode rather than drove, from either place a trip
 * summary is shown, at any time after the trip — not only in the seconds after it ends.
 * @description
 * Phase 1 of `docs/driver-identification.md`, client half (CAR-221): the only source of
 * labelled passenger trips we have, since nothing classifies one yet. It declares who
 * was behind the wheel and removes nothing — the wording carries that, because a driver
 * who reads it as "delete this trip" has been handed a way to erase bad drives.
 *
 * The verdict is always the server's. It is read on mount and re-read out of the
 * declaration's own answer, never assumed from the fact that a request was sent: a
 * passenger trip stops counting towards the driver score on the server's terms, and
 * this screen is not entitled to claim that on its behalf.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { ICONS } from '@/constants/icons';
import { COLORS, COMMON_STYLES, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTranslation } from '@/hooks/useTranslation';
import { tripsApi, type Occupancy } from '@/services/api/trips.api';

interface TripOccupancyControlProps {
  /** A server trip id. A trip that never reached the server has nothing to declare against. */
  tripId: string;
}

export function TripOccupancyControl({ tripId }: TripOccupancyControlProps) {
  const { t } = useTranslation();
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Guarded against a screen dismissed mid-flight: the summary modal closes on a tap
    // and this fetch outlives it.
    let live = true;
    setLoading(true);
    tripsApi
      .occupancy(tripId)
      .then(answer => { if (live) { setOccupancy(answer); setFailed(false); } })
      // A failed read leaves the control offering the declaration rather than hiding it.
      // Declaring twice is the same write, so the cost of guessing wrong here is nothing,
      // while hiding the control would cost the label this whole phase exists to collect.
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tripId]);

  const declare = async (wasDriving: boolean) => {
    setLoading(true);
    try {
      // Always unprompted: nothing in the app raises a prompt to answer yet.
      setOccupancy(await tripsApi.declareOccupancy(tripId, wasDriving, false));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const declaredPassenger = occupancy?.verdict === 'PASSENGER';

  return (
    <View style={styles.block}>
      {declaredPassenger ? (
        <>
          {/* The sentence is the server's answer, not this screen's inference: it is
              claimed only while the server says the trip is actually out of the score. */}
          {occupancy.excludedFromDriverScore && (
            <View style={COMMON_STYLES.noticeRow}>
              <Ionicons name={ICONS.passenger} size={16} color={COLORS.textMuted} />
              <Text style={COMMON_STYLES.noticeText}>{t('trip.occupancyDeclared')}</Text>
            </View>
          )}
          <Button variant="ghost" size="sm" disabled={loading} onPress={() => declare(true)}>
            {t('trip.occupancyUndo')}
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" size="md" fullWidth disabled={loading} onPress={() => declare(false)}>
            {t('trip.occupancyPassengerCta')}
          </Button>
          <Text style={styles.explainer}>{t('trip.occupancyExplainer')}</Text>
        </>
      )}

      {loading && <ActivityIndicator style={styles.spinner} color={COLORS.brand} />}
      {failed && !loading && <Text style={styles.error}>{t('trip.occupancyFailed')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  block:     { width: '100%', alignItems: 'center', marginTop: SPACING.md },
  explainer: { ...TYPOGRAPHY.caption, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.sm },
  spinner:   { marginTop: SPACING.sm },
  error:     { ...TYPOGRAPHY.caption, color: COLORS.danger, textAlign: 'center', marginTop: SPACING.sm },
});
