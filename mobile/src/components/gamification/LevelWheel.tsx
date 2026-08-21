import React, { useCallback, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, Pressable, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Progress } from '@/components/ui/Progress';
import { COLORS, TYPOGRAPHY } from '@/constants/theme';
import { ICONS, levelTheme } from '@/constants/icons';
import { getUserLevelData } from '@/lib/constants';
import { localize } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { LevelConfig, Language } from '@/types';

interface LevelWheelProps {
  levels: LevelConfig[];
  currentLevel: number;
  currentPoints: number;
  lang: Language;
}

// Both box heights are fixed, so a centered level is the same size whether or not it
// happens to have perks or a progress bar. Without this, level 2 (no perks) looked
// like a side box while level 3 (one perk) looked like a centered one.
const CENTER_BOX = 86;
const SIDE_BOX = 52;
// Slot height drives the snap interval; the slack over CENTER_BOX is the visible gap.
const ITEM_HEIGHT = 106;
const VISIBLE = 3;
// Odd repeat count around the real level list — dragging feels endless in normal use,
// re-centering only kicks in if a single gesture scrolls several loops. Not truly
// infinite; raise REPEAT if that ever becomes reachable in practice.
const REPEAT = 9;
// How far the side levels sit to the right of the centered one — the ")" curve. The
// scroll content reserves this much on both sides so a shifted row can't run off-screen.
const ARC_OFFSET = 14;
// Not-current levels (locked or completed) are dimmed by this much, centered or not.
const DIMMED_OPACITY = 0.4;
const CENTER_BUBBLE = 46;
const SIDE_BUBBLE = 30;

// ─── The track the bubbles ride on ───────────────────────────────────────────
// A static arc drawn behind the wheel: the bubbles roll past it, it never moves.
// Width of the strip the arc is drawn in, anchored to the right edge — wide enough
// to hold the bubble column plus the arc's overshoot past the top and bottom rows.
const TRACK_WIDTH = 120;
const TRACK_STROKE = 28; // stays under CENTER_BUBBLE so the bubbles read as sitting on it
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE;

/**
 * The arc passes through all three bubble centres: the two side bubbles sit
 * ARC_OFFSET further right and are smaller, so their centres and the centre
 * bubble's are what fix the circle. Radius from the standard chord/sagitta
 * relation, then the path is extended to the full height so it bleeds off both
 * ends rather than stopping at the first and last row.
 */
function trackPath(): string {
  const midY = WHEEL_HEIGHT / 2;
  const centerCx = TRACK_WIDTH - ARC_OFFSET - CENTER_BUBBLE / 2;
  const sideCx = TRACK_WIDTH - SIDE_BUBBLE / 2;
  const sagitta = sideCx - centerCx;
  const halfChord = ITEM_HEIGHT; // centre row to either side row
  const r = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
  const circleCx = centerCx + r;
  // Where the circle crosses the top and bottom edges of the wheel
  const edgeX = circleCx - Math.sqrt(r * r - midY * midY);
  // sweep-flag 0 keeps the bulge on the left; flipping it to 1 mirrors the curve.
  return `M ${edgeX},0 A ${r},${r} 0 0,0 ${edgeX},${WHEEL_HEIGHT}`;
}

// Depends only on the constants above — no reason to recompute it per render.
const TRACK_PATH = trackPath();

export function LevelWheel({ levels, currentLevel, currentPoints, lang }: LevelWheelProps) {
  const { t } = useTranslation();
  const total = levels.length;
  // The ladder comes from GET /api/levels, so an empty one is reachable. Every
  // index below is modulo `total`, which without this would be a divide by zero
  // and a scrollTo(NaN) rather than an empty wheel.
  const hasLevels = total > 0;
  const mid = Math.floor(REPEAT / 2);
  const repeated: LevelConfig[] = Array.from({ length: REPEAT }, () => levels).flat();
  const initialIndex = mid * total + (currentLevel - 1);

  const scrollRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(initialIndex * ITEM_HEIGHT)).current;
  const [centeredIndex, setCenteredIndex] = useState(initialIndex);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    setCenteredIndex(prev => (prev === idx ? prev : idx));
  }, []);

  const handleMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    // Near either edge of the repeated range — jump to the equivalent spot in the middle
    // repetition, unanimated so it is invisible, leaving room to keep rolling either way.
    if (idx < total || idx > repeated.length - total) {
      const recentered = mid * total + (idx % total);
      scrollRef.current?.scrollTo({ y: recentered * ITEM_HEIGHT, animated: false });
      setCenteredIndex(recentered);
    }
  }, [repeated.length, total, mid]);

  // After the hooks, never before them — the hook order has to stay stable.
  if (!hasLevels) return null;

  return (
    <View style={{ height: WHEEL_HEIGHT }}>
      {/* Behind everything, and never intercepting a drag */}
      <Svg
        width={TRACK_WIDTH}
        height={WHEEL_HEIGHT}
        // The path is drawn with the bubbles against the strip's right edge. SVG
        // coordinates don't mirror with writing direction, so flip it in English,
        // where the strip sits against the left edge of the screen instead.
        style={[styles.track, lang !== 'HE' && { transform: [{ scaleX: -1 }] }]}
        pointerEvents="none"
      >
        <Path
          d={TRACK_PATH}
          stroke={COLORS.border}
          strokeOpacity={0.7}
          strokeWidth={TRACK_STROKE}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>

      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        // Android hands vertical drags to the outer screen ScrollView unless the inner
        // one opts in; without this the wheel is clickable but not draggable.
        nestedScrollEnabled
        snapToInterval={ITEM_HEIGHT}
        disableIntervalMomentum
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT, paddingHorizontal: ARC_OFFSET }}
        onLayout={() => scrollRef.current?.scrollTo({ y: initialIndex * ITEM_HEIGHT, animated: false })}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true, listener: handleScroll },
        )}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {repeated.map((lvl, i) => {
          const isCentered = i === centeredIndex;
          const isRealCompleted = currentLevel > lvl.level;
          const isRealCurrent = currentLevel === lvl.level;
          const isRealLocked = currentLevel < lvl.level;
          const theme = levelTheme(lvl.level);

          const itemY = i * ITEM_HEIGHT;
          // The ")" curve: horizontal offset grows smoothly as an item scrolls away
          // from the centered slot, in either direction.
          const translateX = scrollY.interpolate({
            inputRange: [itemY - ITEM_HEIGHT, itemY, itemY + ITEM_HEIGHT],
            outputRange: [ARC_OFFSET, 0, ARC_OFFSET],
            extrapolate: 'clamp',
          });

          const size = isCentered ? CENTER_BUBBLE : SIDE_BUBBLE;
          const frameColor = isRealLocked ? COLORS.border : theme.color;
          const iconColor = isRealLocked ? COLORS.textMuted : theme.color;
          const nameColor = isRealLocked ? COLORS.textMuted : theme.color;
          // Centered slot carries the emphasis — heavier frame and a stronger tint on
          // both the bubble and the info box. A position highlight, independent of the
          // level's real status, which opacity above already signals.
          const frameWidth = isCentered ? 3 : 1;
          const tint = isRealLocked ? COLORS.card : theme.color + (isCentered ? '26' : '14');

          return (
            <Pressable
              key={i}
              onPress={() => !isCentered && scrollRef.current?.scrollTo({ y: i * ITEM_HEIGHT, animated: true })}
              disabled={isCentered}
            >
              <Animated.View
                style={[
                  styles.slot,
                  {
                    height: ITEM_HEIGHT,
                    transform: [{ translateX }],
                    opacity: isRealCurrent ? 1 : DIMMED_OPACITY,
                  },
                ]}
              >
                {/* Bubble first in JSX so RTL's automatic row-flip lands it on the right */}
                <View
                  style={[
                    styles.bubble,
                    { width: size, height: size, borderRadius: size / 2, borderWidth: frameWidth, borderColor: frameColor, backgroundColor: tint },
                  ]}
                >
                  <Ionicons name={theme.icon} size={isCentered ? 21 : 15} color={iconColor} />
                </View>

                <View
                  style={[
                    styles.infoBox,
                    { height: isCentered ? CENTER_BOX : SIDE_BOX, borderWidth: frameWidth, borderColor: frameColor, backgroundColor: tint },
                  ]}
                >
                  <Text style={[styles.levelName, { color: nameColor, fontSize: isCentered ? 15 : 13 }]} numberOfLines={1}>
                    {t('common.level')} {lvl.level} · {localize(lvl.name, lvl.nameEn, lang)}
                    {isRealCurrent && <Text style={[styles.tag, { color: theme.color }]}> ← {t('roadmap.currentLevel')}</Text>}
                  </Text>

                  <View style={styles.metaRow}>
                    {isRealCompleted && <Ionicons name={ICONS.active} size={13} color={COLORS.success} />}
                    {isRealLocked && <Ionicons name={ICONS.locked} size={13} color={COLORS.textMuted} />}
                    <Text style={styles.minPoints}>{lvl.minPoints.toLocaleString()}</Text>
                  </View>

                  {/* Perks and progress are the centered box only — side boxes stay minimal */}
                  {isCentered && !isRealCurrent && lvl.perks.length > 0 && (
                    <View style={styles.perks}>
                      {lvl.perks.slice(0, 1).map(perk => (
                        <View key={perk} style={styles.perkRow}>
                          <Text style={styles.perkDot}>•</Text>
                          <Text style={[styles.perkText, isRealLocked && { color: COLORS.textMuted }]} numberOfLines={1}>{perk}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Real progress only means something on the level the driver is on.
                      Same stats layout as DashboardHero — points-to-next, no percentage. */}
                  {isCentered && isRealCurrent && (() => {
                    const levelData = getUserLevelData(currentPoints);
                    return (
                      <View style={styles.progressBlock}>
                        <Progress value={levelData.progress} color={theme.color} height={5} showValue={false} />
                        <View style={styles.progressStatsRow}>
                          <Text style={styles.progressLabel}>{currentPoints.toLocaleString()} {t('common.points')}</Text>
                          {!levelData.isMaxLevel && (
                            <Text style={styles.progressLabel}>{levelData.pointsToNext.toLocaleString()} {t('dashboard.pointsToNextLevel')}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })()}
                </View>
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // `start`, not `right`: the bubble column is the row's first child, so it lands on
  // the writing-direction start edge — right in Hebrew, left in English — and the
  // track has to follow it. Physical `right` mirrored to the wrong side under the
  // root's `direction: rtl`.
  track: { position: 'absolute', start: 0, top: 0 },

  // Transparent wrapper — the frames belong to the bubble and the info box, not here
  slot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  bubble: { alignItems: 'center', justifyContent: 'center' },
  infoBox: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, overflow: 'hidden' },

  levelName: { ...TYPOGRAPHY.h3, fontSize: 15 },
  tag: { fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  minPoints: { ...TYPOGRAPHY.caption, fontSize: 11 },

  perks: { marginTop: 5, gap: 2 },
  perkRow: { flexDirection: 'row', gap: 4 },
  perkDot: { color: COLORS.textMuted, fontSize: 12 },
  perkText: { color: COLORS.text, fontSize: 12, flex: 1 },

  progressBlock: { marginTop: 6, gap: 3 },
  progressStatsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { ...TYPOGRAPHY.caption, fontSize: 10, color: COLORS.text },
});
