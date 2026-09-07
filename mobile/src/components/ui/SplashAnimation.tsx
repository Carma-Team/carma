import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { C_BOX, C_CENTRE_X, C_PARTS, LETTERS, LOGO_HEIGHT, LOGO_WIDTH } from '@/constants/logo';

// Apple forbids animating the launch screen and Google caps the Android 12 one
// at 1000ms, so the intro plays here instead, once the native splash hands over.
//
// It runs 2040ms, which is over that budget and deliberate: the assembly is the
// brand moment and reads as nothing at half the length. It is not 2040ms of
// added wait, because the component holds until `ready` anyway and session
// restore runs underneath it. Shorten ASSEMBLE_MS first if it ever has to come
// down - it alone is more than half the sequence.
const ASSEMBLE_MS = 1200;
const PART_STAGGER = 75;
const SHIFT_DELAY = 1150;
const SHIFT_MS = 375;
const LETTERS_DELAY = 1475;
const LETTER_STAGGER = 70;
const SEQUENCE_MS = 2040;
const FADE_OUT_MS = 260;

// The C is born this many times its final size and unwinds a full turn into
// place. Both were chosen on the motion preview, not derived from anything.
const C_START_SCALE = 6;
const C_START_TURN = '-360deg';

// The splash inverts the app palette: the mark is knocked out of the brand
// ground, the way the app icon is. Spelled out rather than taken from COLORS
// because that palette has no token that reads as white - COLORS.dark is
// #ffffff, and a white logo filled with `COLORS.dark` reads as a bug.
// GROUND_TOP must stay equal to the expo-splash-screen backgroundColor in
// app.json: the native splash can only hold a flat colour, so that is the one
// the gradient has to start from or the handover shows a step.
const GROUND_TOP = COLORS.brand;
const GROUND_MID = COLORS.brandLight;
const GROUND_DEEP = '#1e1b4b';
const MARK = '#ffffff';
const TAGLINE_ON_GROUND = 'rgba(255,255,255,0.85)';

// A few units of travel each, so the strokes still settle into place instead of
// only fading up. Wordmark units, and inside the C group, so the spin scales
// them the way it scales everything else.
const PART_DRIFT: readonly { angle: number; distance: number }[] = [
  { angle: -105, distance: 26 },
  { angle: -60, distance: 19 },
  { angle: 170, distance: 30 },
  { angle: 135, distance: 23 },
  { angle: 50, distance: 25 },
  { angle: 15, distance: 17 },
  { angle: 95, distance: 21 },
];

// English in both languages, and not from i18n: on this screen the line is part
// of the lock-up rather than interface copy, the way the wordmark itself is.
// `app.tagline` still exists and is still translated - LoginScreen and
// RegisterScreen use it, and they should keep doing so.
// The bracketing characters are U+2066 LEFT-TO-RIGHT ISOLATE and U+2069 POP
// DIRECTIONAL ISOLATE, and they are load-bearing: with the app in Hebrew the
// paragraph direction is RTL, and the full stop is a neutral character, so it
// gets laid out at the start of the line instead of the end. `writingDirection`
// is the documented fix but React Native marks it iOS-only and Android support
// is inconsistent, so the isolate does the work on both.
const TAGLINE = '\u2066Drive safely. Earn rewards.\u2069';

type Props = {
  /** Session restore finished. The intro still plays out in full first. */
  ready: boolean;
  onDone: () => void;
};

export default function SplashAnimation({ ready, onDone }: Props) {
  const { width } = useWindowDimensions();
  const assemble = useRef(new Animated.Value(0)).current;
  const parts = useRef(new Animated.Value(0)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const letters = useRef(LETTERS.map(() => new Animated.Value(0))).current;
  const [introDone, setIntroDone] = useState(false);

  // One scale factor for the whole lock-up keeps the designer's kerning intact;
  // every position below is a wordmark coordinate multiplied by it.
  const k = Math.min(width * 0.62, 300) / LOGO_WIDTH;

  // Each stroke fades up over its own slice of the assembly, which is what makes
  // the C look built rather than revealed. Ends are wordmark-time fractions.
  const partRanges = useMemo(
    () =>
      C_PARTS.map((_, i) => {
        const start = i * PART_STAGGER;
        return [start / ASSEMBLE_MS, (start + (ASSEMBLE_MS - start) * 0.42) / ASSEMBLE_MS];
      }),
    []
  );

  // `parts` runs linearly so each stroke can carry its own stagger, so the
  // quintic ease the rest of the assembly uses has to be sampled by hand.
  // These are 1 - easeOutQuint at five even steps.
  const partMotion = useMemo(() => {
    const decay = [1, 0.2373, 0.0312, 0.001, 0];
    return C_PARTS.map((_, i) => {
      const start = (i * PART_STAGGER) / ASSEMBLE_MS;
      const radians = (PART_DRIFT[i].angle * Math.PI) / 180;
      const reach = PART_DRIFT[i].distance * k;
      return {
        input: decay.map((_unused, j) => start + ((1 - start) * j) / (decay.length - 1)),
        x: decay.map((d) => Math.cos(radians) * reach * d),
        y: decay.map((d) => Math.sin(radians) * reach * d),
      };
    });
  }, [k]);

  useEffect(() => {
    let cancelled = false;

    // Reduce Motion kills the spin and the slide, never the cross-fade: a fade is
    // what Apple prescribes as the replacement for motion, not a third state.
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        SplashScreen.hideAsync().catch(() => {});

        if (reduceMotion) {
          assemble.setValue(1);
          parts.setValue(1);
          shift.setValue(1);
          sub.setValue(1);
          letters.forEach((l) => l.setValue(1));
          setIntroDone(true);
          return;
        }

        Animated.parallel([
          Animated.timing(assemble, {
            toValue: 1,
            duration: ASSEMBLE_MS,
            easing: Easing.out(Easing.poly(5)),
            useNativeDriver: true,
          }),
          Animated.timing(parts, {
            toValue: 1,
            duration: ASSEMBLE_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(shift, {
            toValue: 1,
            delay: SHIFT_DELAY,
            duration: SHIFT_MS,
            easing: Easing.out(Easing.poly(5)),
            useNativeDriver: true,
          }),
          // Every letter lands on the same frame; the stagger is in when each
          // one leaves, so the word resolves as a group instead of trailing off.
          ...letters.map((value, i) =>
            Animated.timing(value, {
              toValue: 1,
              delay: LETTERS_DELAY + i * LETTER_STAGGER,
              duration: SEQUENCE_MS - (LETTERS_DELAY + i * LETTER_STAGGER),
              easing: Easing.out(Easing.back(1.05)),
              useNativeDriver: true,
            })
          ),
          Animated.timing(sub, {
            toValue: 1,
            delay: LETTERS_DELAY,
            duration: SEQUENCE_MS - LETTERS_DELAY,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !cancelled) setIntroDone(true);
        });
      });

    return () => {
      cancelled = true;
    };
  }, [assemble, parts, shift, sub, letters]);

  const finish = useCallback(() => onDone(), [onDone]);

  useEffect(() => {
    if (!ready || !introDone) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) finish();
    });
  }, [ready, introDone, fade, finish]);

  const lockWidth = LOGO_WIDTH * k;
  const lockHeight = LOGO_HEIGHT * k;

  return (
    <Animated.View style={[styles.screen, { opacity: fade }]}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="ground" cx="30%" cy="18%" r="118%">
            <Stop offset="0" stopColor={GROUND_TOP} />
            <Stop offset="0.58" stopColor={GROUND_MID} />
            <Stop offset="1" stopColor={GROUND_DEEP} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ground)" />
      </Svg>

      <View style={{ width: lockWidth, height: lockHeight }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                {
                  // Centres the C on screen while it assembles, then gives the
                  // width back to the word.
                  translateX: shift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [(LOGO_WIDTH / 2 - C_CENTRE_X) * k, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Rendered before the C so the mark paints over them: that overlap is
              what makes the letters read as coming out from behind it. */}
          {LETTERS.map((letter, i) => (
            <Animated.View
              key={letter.id}
              style={{
                position: 'absolute',
                left: letter.x * k,
                width: letter.width * k,
                height: lockHeight,
                opacity: letters[i].interpolate({
                  inputRange: [0, 0.4],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateX: letters[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [(C_CENTRE_X - (letter.x + letter.width / 2)) * k, 0],
                    }),
                  },
                  // Unclamped on purpose: the back easing overshoots past 1 and
                  // that overshoot is the settle.
                  {
                    scale: letters[i].interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.32, 1],
                    }),
                  },
                ],
              }}
            >
              <Svg
                width="100%"
                height="100%"
                viewBox={`${letter.x} 0 ${letter.width} ${LOGO_HEIGHT}`}
              >
                <Path d={letter.d} fill={MARK} />
              </Svg>
            </Animated.View>
          ))}

          <Animated.View
            style={{
              position: 'absolute',
              left: C_BOX.x * k,
              width: C_BOX.width * k,
              height: lockHeight,
              transform: [
                { scale: assemble.interpolate({ inputRange: [0, 1], outputRange: [C_START_SCALE, 1] }) },
                {
                  rotate: assemble.interpolate({
                    inputRange: [0, 1],
                    outputRange: [C_START_TURN, '0deg'],
                  }),
                },
              ],
            }}
          >
            {C_PARTS.map((d, i) => (
              <Animated.View
                key={i}
                style={[
                  StyleSheet.absoluteFill,
                  {
                    opacity: parts.interpolate({
                      inputRange: partRanges[i],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateX: parts.interpolate({
                          inputRange: partMotion[i].input,
                          outputRange: partMotion[i].x,
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: parts.interpolate({
                          inputRange: partMotion[i].input,
                          outputRange: partMotion[i].y,
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Svg
                  width="100%"
                  height="100%"
                  viewBox={`${C_BOX.x} 0 ${C_BOX.width} ${LOGO_HEIGHT}`}
                >
                  <Path d={d} fill={MARK} />
                </Svg>
              </Animated.View>
            ))}
          </Animated.View>
        </Animated.View>
      </View>

      <Animated.Text style={[styles.tagline, { opacity: sub }]}>{TAGLINE}</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Under the gradient rather than instead of it: whatever frame lands before
    // the SVG paints is then the native splash's colour, not white.
    backgroundColor: GROUND_TOP,
  },
  tagline: {
    ...TYPOGRAPHY.caption,
    color: TAGLINE_ON_GROUND,
    fontSize: 15,
    marginTop: SPACING.lg,
    // Belt and braces with the isolate around TAGLINE: this is the documented
    // fix, the isolate is the one that survives Android.
    writingDirection: 'ltr',
    textAlign: 'center',
  },
});
