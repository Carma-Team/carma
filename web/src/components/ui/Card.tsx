import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

type CardVariant = 'default' | 'sunken';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

export function Card({ variant = 'default', className, ...props }: CardProps) {
  return <div className={[styles.card, styles[variant], className].filter(Boolean).join(' ')} {...props} />;
}
