import type { HTMLAttributes } from 'react';
import { Text } from './Typography';
import styles from './LoadingState.module.css';

type LoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
};

export function LoadingState({ label, className, ...rest }: LoadingStateProps) {
  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')} role="status" {...rest}>
      <span className={styles.spinner} aria-hidden="true" />
      {label && <Text variant="caption">{label}</Text>}
    </div>
  );
}
