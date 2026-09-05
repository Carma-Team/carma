import type { HTMLAttributes } from 'react';
import { BrandMark } from './Logo';
import { Text } from './Typography';
import styles from './LoadingState.module.css';

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  // 'inline' (default) is a small spinner for a section or dialog body.
  // 'page' is the brand C-mark pulse, reserved for a full-page load only —
  // never inside a button or a short in-place refresh, per the style guide.
  variant?: 'inline' | 'page';
};

export function LoadingState({ label, variant = 'inline', className, ...rest }: LoadingStateProps) {
  return (
    <div
      className={[styles.container, variant === 'page' && styles.page, className].filter(Boolean).join(' ')}
      role="status"
      {...rest}
    >
      {variant === 'page' ? (
        <BrandMark animated size={44} />
      ) : (
        <span className={styles.spinner} aria-hidden="true" />
      )}
      {label && <Text variant="caption">{label}</Text>}
    </div>
  );
}

type SkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  width?: string | number;
  height?: number;
};

// A shimmer block shaped like the real content — style guide: "the shape of
// the real content, not a spinner over an empty screen."
export function Skeleton({ width = '100%', height = 11, className, style, ...rest }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}
