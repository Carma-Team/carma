/**
 * The wordmark is English in both languages, so the splash lock-up has to sit in
 * the middle of the screen and read left to right even with the app in Hebrew.
 * `left`/`right` cannot express that: React Native maps both onto the leading
 * edge under RTL, which pushed CARMA off the right of the screen. These tests
 * pin the placement that does survive - centred, with a centre-relative offset.
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import SplashAnimation from '@/components/ui/SplashAnimation'
import { C_BOX, C_CENTRE_X, LETTERS, LOGO_WIDTH } from '@/constants/logo'

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(() => Promise.resolve()) }))

// Reduce Motion drops the timers and lands every value on its resting state, so
// the assertions read the geometry rather than a frame of the animation.
jest.spyOn(
  require('react-native').AccessibilityInfo,
  'isReduceMotionEnabled'
).mockResolvedValue(true)

const glyphStyle = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, any>

/** The base offset is the one plain number in the transform list. */
const baseTranslateX = (style: Record<string, any>) => style.transform[0].translateX

describe('SplashAnimation lock-up placement', () => {
  // The reduce-motion lookup resolves a tick after mount and settles the values,
  // so the render is flushed before anything is read.
  beforeEach(async () => {
    render(<SplashAnimation ready={false} onDone={jest.fn()} />)
    await act(async () => {})
  })

  it('places every glyph from the centre, never from an edge', () => {
    for (const testID of ['splash-glyph-c', ...LETTERS.map((l) => `splash-glyph-${l.id}`)]) {
      const style = glyphStyle(testID)
      expect(style.alignSelf).toBe('center')
      expect(style.left).toBeUndefined()
      expect(style.right).toBeUndefined()
    }
  })

  it('keeps the designer kerning, measured from the centre of the wordmark', () => {
    // Taken from the rendered C rather than from window dimensions, so the test
    // does not care what screen size the runner reports.
    const k = glyphStyle('splash-glyph-c').width / C_BOX.width

    expect(baseTranslateX(glyphStyle('splash-glyph-c'))).toBeCloseTo(
      (C_CENTRE_X - LOGO_WIDTH / 2) * k
    )

    for (const letter of LETTERS) {
      expect(baseTranslateX(glyphStyle(`splash-glyph-${letter.id}`))).toBeCloseTo(
        (letter.x + letter.width / 2 - LOGO_WIDTH / 2) * k
      )
    }
  })
})
