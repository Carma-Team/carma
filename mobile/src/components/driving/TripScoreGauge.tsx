import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Polygon, Circle, Text as SvgText } from 'react-native-svg';
import { COLORS } from '@/constants/theme';
import { scoreToColor } from '@/lib/utils';

interface TripScoreGaugeProps {
  score: number;
  /** Rendered width in px; height follows the gauge's own aspect ratio. */
  width?: number;
}

// The gauge is drawn in a fixed viewBox and scaled to whatever width the caller
// asks for, so every constant below is in that space rather than in pixels.
// The dial is a true circle — flattening it into an ellipse to gain width made
// the bands look stretched. Width comes from rendering it larger instead.
const VB_W = 200;  // drawing-space width; the rendered size scales to this ratio
const VB_H = 124;  // raise to add room under the 0/100 labels, lower to crop it
const CX = 100;    // dial centre — half of VB_W keeps the gauge symmetrical
const CY = 100;    // the hub, and the flat line the arc's two ends sit on

// Arc radius. Bigger fills more of the drawing space, so the gauge reads larger
// without the rendered width changing. Keep R + half of BAND_WIDTH under CX or
// the arc runs off the left and right edges.
const R = 84;
// Band thickness. Under about 8 the colours get hard to tell apart on a phone.
const BAND_WIDTH = 13;

// Needle length, from the hub outward. Well short of R so the tip points at a
// band rather than covering it. Shorten this if the needle crowds the score.
const NEEDLE_R = 66;
// Half the needle's width where it meets the hub — what makes it a taper, not a line.
const NEEDLE_HALF_W = 6;

// Baseline of the score, sitting up under the arc rather than down by the hub.
// Lower numbers move it further up toward the arc; CY (100) would put it on the
// hub. The needle sweeps through here at mid-range scores, which is what the
// outline on the digits is for — the number is drawn last and stays legible.
const SCORE_Y = 65;
const SCORE_SIZE = 34;      // score font size
// Outline behind the digits. Only there to hold the number apart from the needle
// when the two overlap at mid-range scores, so it wants to be the thinnest line
// that still separates them — thicker and it starts closing up the 8 and the 0.
const SCORE_OUTLINE = 1.5;
// Baseline of the 0 and 100 labels. Lower brings them up against the arc ends;
// below about 112 they start touching the band, and VB_H (124) is the floor.
const END_LABEL_Y = 112;
const END_LABEL_SIZE = 10;

// Breathing room left inside whatever contains the gauge, so the 0 and 100 labels
// never sit flush against its edge. Shrink it to make the gauge wider.
const GAUGE_INSET = 24;
// Ceiling so the gauge does not become enormous on a tablet.
const MAX_WIDTH = 380;

/** Score 0–100 to its angle on the dial: 0 at due west, 100 at due east. */
function angleFor(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return 180 - clamped * 1.8;
}

/**
 * The four coloured bands, each spanning exactly the score range that
 * `scoreToColor` gives that colour — so the band the needle lands in is always
 * the same colour the score is shown in everywhere else in the app. The bands
 * are unequal because the thresholds are (0–55 is the widest by far); that is
 * the scale being honest, not a layout accident.
 *
 * Endpoints are pulled 1° inward at each internal boundary, which is what makes
 * the thin gaps between the bands.
 */
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 180, to: 82, color: '#ef4444' }, // below 55
  { from: 80,  to: 46, color: '#f59e0b' }, // 55–75
  { from: 44,  to: 19, color: '#84cc16' }, // 75–90
  { from: 17,  to: 0,  color: '#22c55e' }, // 90 and above
];

function pointOn(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY - radius * Math.sin(rad)];
}

function arc(from: number, to: number): string {
  const [x1, y1] = pointOn(from, R);
  const [x2, y2] = pointOn(to, R);
  // Every band is under 180°, so large-arc is always 0; sweep 1 runs left-to-right.
  return `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${R},${R} 0 0,1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

export function TripScoreGauge({ score, width }: TripScoreGaugeProps) {
  // Measured from the container rather than from the screen: the same gauge sits
  // both on a full-width screen and inside the narrower summary modal, and sizing
  // it off the screen made it wider than the modal could hold.
  const [containerWidth, setContainerWidth] = useState(0);
  const drawWidth = width ?? Math.min(containerWidth - GAUGE_INSET, MAX_WIDTH);
  const rounded = Math.round(score);
  const color = scoreToColor(rounded);
  const rad = (angleFor(rounded) * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);

  // A tapered needle: two base corners either side of the hub, meeting at a point.
  const needle = [
    [CX + NEEDLE_R * cos, CY - NEEDLE_R * sin],
    [CX + NEEDLE_HALF_W * sin, CY + NEEDLE_HALF_W * cos],
    [CX - NEEDLE_HALF_W * sin, CY - NEEDLE_HALF_W * cos],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const [endLeftX] = pointOn(180, R);
  const [endRightX] = pointOn(0, R);

  return (
    <View
      style={styles.wrapper}
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {drawWidth > 0 && (
      <Svg width={drawWidth} height={(drawWidth * VB_H) / VB_W} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        {BANDS.map(band => (
          <Path
            key={band.color}
            d={arc(band.from, band.to)}
            stroke={band.color}
            strokeWidth={BAND_WIDTH}
            fill="none"
          />
        ))}

        <Polygon points={needle} fill={COLORS.textMuted} />
        {/* The hub: outer disc, then a small hole in the screen colour through it */}
        <Circle cx={CX} cy={CY} r={8} fill={COLORS.textMuted} />
        <Circle cx={CX} cy={CY} r={3} fill={COLORS.dark} />

        {/* Drawn twice: the outline underneath, the fill on top. A single stroked
            glyph would have the outline eat into the digits from both sides. */}
        <SvgText
          x={CX} y={SCORE_Y} textAnchor="middle" fontSize={SCORE_SIZE} fontWeight="900"
          stroke={COLORS.textMuted} strokeWidth={SCORE_OUTLINE} fill={COLORS.textMuted}
        >
          {rounded}
        </SvgText>
        <SvgText
          x={CX} y={SCORE_Y} textAnchor="middle" fontSize={SCORE_SIZE} fontWeight="900" fill={color}
        >
          {rounded}
        </SvgText>

        {/* Range ends, pinned to where the arc actually starts and stops */}
        <SvgText x={endLeftX} y={END_LABEL_Y} textAnchor="middle" fontSize={END_LABEL_SIZE} fill={COLORS.textMuted}>0</SvgText>
        <SvgText x={endRightX} y={END_LABEL_Y} textAnchor="middle" fontSize={END_LABEL_SIZE} fill={COLORS.textMuted}>100</SvgText>
      </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Stretches to the container so onLayout reports the real width available.
  wrapper: { alignItems: 'center', alignSelf: 'stretch' },
});
