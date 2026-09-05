import type { ReactNode } from 'react';
import { Card } from './Card';
import { Text } from './Typography';
import styles from './MetricCard.module.css';

type MetricCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: ReactNode;
  className?: string;
};

export function MetricCard({ label, value, hint, trend, className }: MetricCardProps) {
  return (
    <Card className={[styles.card, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <Text variant="eyebrow">{label}</Text>
        {trend && <span className={styles.trend}>{trend}</span>}
      </div>
      <Text variant="metric" as="div">
        {value}
      </Text>
      {hint && (
        <Text variant="caption" className={styles.hint}>
          {hint}
        </Text>
      )}
    </Card>
  );
}
