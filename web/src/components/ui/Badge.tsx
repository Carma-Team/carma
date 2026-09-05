import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone: StatusTone;
  // A leading icon replaces the default dot — e.g. the "redeemed" ticket
  // icon in the style guide. Decorative only.
  icon?: ReactNode;
};

// State facts (active/pending/expired/…) — tint + text pair per tone, never
// used for category taxonomy (see the style guide's "category tints" note:
// a red "Food & drink" chip is not an error).
export function StatusBadge({ tone, icon, children, className, ...props }: StatusBadgeProps) {
  return (
    <span className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')} {...props}>
      {icon ? (
        <span aria-hidden="true">{icon}</span>
      ) : (
        <span className={styles.dot} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

type CountBadgeProps = HTMLAttributes<HTMLSpanElement>;

// A plain count chip — nav item counters, tab counts. Not a status signal.
export function CountBadge({ className, ...props }: CountBadgeProps) {
  return <span className={[styles.count, className].filter(Boolean).join(' ')} {...props} />;
}
