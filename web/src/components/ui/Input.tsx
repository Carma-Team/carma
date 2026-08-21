import { useId, type InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function Input({ label, error, id, className, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[styles.input, error && styles.inputError, className].filter(Boolean).join(' ')}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
