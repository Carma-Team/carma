import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Alert.module.css';

// Matches StatusBadge's tone names (Badge.tsx) — 'danger', not 'error' —
// since both consume the same shared tone-* classes in styles/tones.css.
type AlertTone = 'danger' | 'warning' | 'success' | 'info';

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

function AlertCircleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
