import { Text } from './Typography';
import styles from './LoadingState.module.css';

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div className={styles.container} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {label && <Text variant="caption">{label}</Text>}
    </div>
  );
}
