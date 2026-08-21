import { Heading, Text } from './Typography';
import { Button } from './Button';
import styles from './ErrorState.module.css';

type ErrorStateProps = {
  title: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

export function ErrorState({ title, message, retryLabel = 'Retry', onRetry }: ErrorStateProps) {
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
