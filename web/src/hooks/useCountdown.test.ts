import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown, formatCountdown } from './useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the remaining time from now to expiresAt', () => {
    const { result } = renderHook(() => useCountdown('2026-01-01T00:05:00Z'));

    expect(result.current.remainingMs).toBe(5 * 60 * 1000);
    expect(result.current.expired).toBe(false);
  });

  it('counts down as real time passes', () => {
    const { result } = renderHook(() => useCountdown('2026-01-01T00:05:00Z'));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.remainingMs).toBe(4 * 60 * 1000);
  });

  it('reports expired once the clock reaches expiresAt, never a negative remainder', () => {
    const { result } = renderHook(() => useCountdown('2026-01-01T00:00:30Z'));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expired).toBe(true);
  });

  it('reports already expired for a past expiresAt on first render', () => {
    const { result } = renderHook(() => useCountdown('2025-12-31T00:00:00Z'));

    expect(result.current.expired).toBe(true);
  });
});

describe('formatCountdown', () => {
  it('formats under an hour as M:SS', () => {
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00');
    expect(formatCountdown(65 * 1000)).toBe('1:05');
  });

  it('formats an hour or more as H:MM:SS', () => {
    expect(formatCountdown(90 * 60 * 1000)).toBe('1:30:00');
  });

  it('never shows a negative duration', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });
});
