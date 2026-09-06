import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon } from './icons';
import styles from './Alert.module.css';

// Matches StatusBadge's tone names (Badge.tsx) — 'danger', not 'error' —
// since both consume the same shared tone-* classes in styles/tones.css.
export type AlertTone = 'danger' | 'warning' | 'success' | 'info';

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone: AlertTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
};

const icons: Record<AlertTone, ReactNode> = {
  danger: <AlertCircleIcon />,
  warning: <AlertTriangleIcon />,
  success: <CheckCircleIcon />,
  info: <AlertCircleIcon />,
};

// A tinted banner — inline list-load failures, and the form validation
// summary shown on submit (style guide: one banner at the top, focus the
// first invalid field). Not for confirming destructive actions — use Dialog.
export function Alert({ tone, title, children, action, role, className, ...props }: AlertProps) {
  return (
    <div className={[styles.alert, `tone-${tone}`, className].filter(Boolean).join(' ')} role={role ?? 'alert'} {...props}>
      <span className={styles.icon} aria-hidden="true">
        {icons[tone]}
      </span>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {children && <div className={styles.message}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}
