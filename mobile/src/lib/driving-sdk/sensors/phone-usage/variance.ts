/**
 * @file variance.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The rolling analysis window shared by both phone-usage detectors, and the
 * variance over it.
 *
 * @description
 * Both detectors describe the same second — one over acceleration magnitude, one over
 * angular speed — so the window length and the variance are defined once here rather
 * than twice, and changing the analysis span changes it for both at the same time.
 */

/** Rolling variance window: 10 samples at 10 Hz = 1-second analysis window. */
export const VARIANCE_WINDOW_SIZE = 10;

/** Population variance of a sample window. Under two samples there is nothing to spread. */
export function computeVariance(window: number[]): number {
  const n = window.length;
  if (n < 2) return 0;
  const mean = window.reduce((s, v) => s + v, 0) / n;
  return window.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
}
