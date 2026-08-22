import type { HTMLAttributes } from 'react';
import { Heading, Text } from './Typography';
import { Button } from './Button';
import styles from './ErrorState.module.css';

type ErrorStateBaseProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: string;
  message?: string;
};

type ErrorStateProps = ErrorStateBaseProps &
  (
    | { onRetry?: undefined; retryLabel?: undefined }
    // retryLabel is only required once a retry button actually renders — no
    // English default here, callers must supply a translated label rather
    // than silently leaking English into a Hebrew page.
    | { onRetry: () => void; retryLabel: string }
  );

export function ErrorState({ title, message, retryLabel, onRetry, className, ...rest }: ErrorStateProps) {
  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')} role="alert" {...rest}>
      <Heading level={3}>{title}</Heading>
      {message && <Text variant="caption">{message}</Text>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
