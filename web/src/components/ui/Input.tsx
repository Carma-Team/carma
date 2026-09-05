import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Input.module.css';

type InputStatus = 'error' | 'warning' | 'success';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  label?: string;
  // Plain, non-validating description shown below the field (style guide:
  // "Hebrew label above, helper text below — never placeholder-as-label").
  helperText?: string;
  error?: string;
  warning?: string;
  success?: string;
  // Sunken, borderless chrome for a list-filtering search field rather than
  // a data-entry one.
  variant?: 'default' | 'search';
  leadingIcon?: ReactNode;
  // Opt-in: only rendered for type="password" and only once a caller
  // supplies translated labels — no English default leaking into a Hebrew
  // page (see Dialog/ErrorState for the same convention).
  revealPasswordLabel?: string;
  hidePasswordLabel?: string;
};

// forwardRef so a caller can move focus to the underlying <input> — e.g.
// CAR-202's reward form, which focuses the first invalid field after a
// failed submit (see RewardForm.tsx). Every other prop is unchanged.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    warning,
    success,
    variant = 'default',
    leadingIcon,
    revealPasswordLabel,
    hidePasswordLabel,
    id,
    className,
    type = 'text',
    ...props
  },
  ref,
) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  const status: InputStatus | undefined = error ? 'error' : warning ? 'warning' : success ? 'success' : undefined;
  const message = error ?? warning ?? success ?? helperText;
  const canReveal = type === 'password' && Boolean(revealPasswordLabel) && Boolean(hidePasswordLabel);
  const resolvedType = canReveal && revealed ? 'text' : type;
  const hasStartIcon = variant === 'search' && leadingIcon;

  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <div className={styles.control}>
        {hasStartIcon && (
          <span className={styles.startIcon} aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={[
            styles.input,
            variant === 'search' && styles.search,
            hasStartIcon && styles.hasStartIcon,
            canReveal && styles.hasEndAction,
            status && styles[status],
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={status === 'error'}
          aria-describedby={message ? messageId : undefined}
          {...props}
        />
        {canReveal && (
          <button
            type="button"
            className={styles.revealButton}
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? hidePasswordLabel : revealPasswordLabel}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {message && (
        <span
          id={messageId}
          role={status === 'error' ? 'alert' : undefined}
          className={[styles.message, status && styles[`${status}Message`]].filter(Boolean).join(' ')}
        >
          {message}
        </span>
      )}
    </div>
  );
});

function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.16 3.19M6.61 6.61A17.7 17.7 0 0 0 2 11s3.5 7 10 7a10.6 10.6 0 0 0 4.24-.88M9.53 9.53a3 3 0 0 0 4.24 4.24" />
      <path d="M2 2l20 20" />
    </svg>
  );
}
