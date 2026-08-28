import { useEffect, useState } from 'react';

export type Countdown = {
  remainingMs: number;
  expired: boolean;
};

// Recomputed against the wall clock on every tick rather than counting down
// from a snapshot taken on mount — a tab left in the background must not
// drift, so each second re-reads Date.now() against the fixed expiresAt.
export function useCountdown(expiresAt: string): Countdown {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  return { remainingMs, expired: remainingMs <= 0 };
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
