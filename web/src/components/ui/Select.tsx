import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './Select.module.css';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  children: ReactNode;
};

// Styled as a native <select> rather than a custom listbox — it matches the
// input chrome from the style guide (height, radius, border, chevron) with
// full keyboard/screen-reader support for free. A richer option menu with
// icons and checkmarks is a per-page concern for whichever design issue
// actually needs it, not the shared foundation.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={selectId} className={styles.label}>
          {label}
        </label>
      )}
      <div className={styles.control}>
        <select
          ref={ref}
          id={selectId}
          className={[styles.select, error && styles.error, className].filter(Boolean).join(' ')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...props}
        >
          {children}
        </select>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </div>
      {error && (
        <span id={errorId} role="alert" className={styles.errorMessage}>
          {error}
        </span>
      )}
    </div>
  );
});

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
