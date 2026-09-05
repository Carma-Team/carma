/**
 * @file variance.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief The rolling analysis window phone-usage detection runs over, and the variance
 * over it.
 *
 * @description
 * Separate from its one caller because the window length is the span every phone-usage
 * number describes — the variance, the tap ageing — and a change to it is a change to
 * all of them at once. It held two detectors until CAR-187 dropped the acceleration
 * half.
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
