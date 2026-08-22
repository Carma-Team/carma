import type { HTMLAttributes, ReactNode } from 'react';
import { Heading, Text } from './Typography';
import styles from './EmptyState.module.css';

type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: string;
  message?: string;
  action?: ReactNode;
};

export function EmptyState({ title, message, action, className, ...rest }: EmptyStateProps) {
  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')} {...rest}>
      <Heading level={3}>{title}</Heading>
      {message && <Text variant="caption">{message}</Text>}
      {action}
    </div>
  );
}
