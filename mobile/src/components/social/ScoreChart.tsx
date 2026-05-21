import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';
import { formatDate } from '@/lib/utils';
import type { Trip, Language } from '@/types';

interface ScoreChartProps {
  trips: Trip[];
  lang: Language;
}

export function ScoreChart({ trips, lang }: ScoreChartProps) {
  return (
    <Card style={styles.container}>
      <Text style={[TYPOGRAPHY.h3, { marginBottom: 20 }]}>מגמת ציונים שבועית</Text>

      <View style={styles.chartContainer}>
        <View style={styles.yAxis}>
          {[100, 75, 50, 25, 0].map(val => (
            <Text key={val} style={styles.axisLabel}>{val}</Text>
          ))}
        </View>

        <View style={styles.chartContent}>
          {[0, 1, 2, 3, 4].map(i => (
            <View key={i} style={[styles.gridLine, { top: `${i * 25}%` }]} />
          ))}

          <View style={styles.barsContainer}>
            {trips.slice(0, 7).reverse().map((trip) => {
              const score = trip.avgScore || trip.score || 0;
              const dateStr = trip.startTime;
              const formatted = dateStr ? formatDate(dateStr, lang) : '--/--';
              return (
                <View key={trip.id} style={styles.barWrapper}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: `${score}%`,
                        backgroundColor: score > 85 ? COLORS.success : score > 70 ? COLORS.warning : COLORS.danger
                      }
                    ]}
                  />
                  <Text style={styles.xLabel}>{formatted}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
      <Text style={[styles.axisLabel, { textAlign: 'center', marginTop: 10, color: COLORS.brandLight }]}>
        ממוצע ציון לפי תאריך נסיעה
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  chartContainer: { flexDirection: 'row', height: 220, paddingRight: 10 },
  yAxis: { width: 30, justifyContent: 'space-between', paddingVertical: 5, alignItems: 'flex-start' },
  axisLabel: { ...TYPOGRAPHY.caption, fontSize: 10, color: COLORS.textMuted },
  chartContent: { flex: 1, marginLeft: 10, position: 'relative', borderLeftWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  barsContainer: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingHorizontal: 5 },
  barWrapper: { alignItems: 'center', flex: 1 },
  bar: { width: 20, borderRadius: 4, opacity: 0.8 },
  xLabel: { ...TYPOGRAPHY.caption, fontSize: 9, marginTop: 8, color: COLORS.textMuted },
});
