import { Heading, Text } from './Typography';
import { Button } from './Button';
import styles from './ErrorState.module.css';

type ErrorStateProps = {
  title: string;
  message?: string;
} & (
  | { onRetry?: undefined; retryLabel?: undefined }
  // retryLabel is only required once a retry button actually renders — no
  // English default here, callers must supply a translated label rather
  // than silently leaking English into a Hebrew page.
  | { onRetry: () => void; retryLabel: string }
);

export function ErrorState({ title, message, retryLabel, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.container} role="alert">
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
