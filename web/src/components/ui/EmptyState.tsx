import type { ReactNode } from 'react';
import { Heading, Text } from './Typography';
import styles from './EmptyState.module.css';

type EmptyStateProps = {
  title: string;
  message?: string;
  action?: ReactNode;
};

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <Heading level={3}>{title}</Heading>
      {message && <Text variant="caption">{message}</Text>}
      {action}
    </div>
  );
}
