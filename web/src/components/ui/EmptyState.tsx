import type { HTMLAttributes, ReactNode } from 'react';
import { Heading, Text } from './Typography';
import styles from './EmptyState.module.css';

type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: string;
  message?: string;
  action?: ReactNode;
  // Decorative icon shown inside the brand-tinted bubble above the title.
  icon?: ReactNode;
};

export function EmptyState({ title, message, action, icon, className, ...rest }: EmptyStateProps) {
  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')} {...rest}>
      {icon && (
        <span className={styles.iconBubble} aria-hidden="true">
          {icon}
        </span>
      )}
      <Heading level={3}>{title}</Heading>
      {message && (
        <Text variant="caption" className={styles.message}>
          {message}
        </Text>
      )}
      {action}
    </div>
  );
}
