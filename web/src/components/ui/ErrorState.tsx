import type { HTMLAttributes } from 'react';
import { Heading, Text } from './Typography';
import { Button } from './Button';
import styles from './ErrorState.module.css';

// Inline, not a CSS class: Heading/Text already set their own color class
// from Typography.module.css, and cascade order between separate CSS
// modules isn't guaranteed — an inline style always wins without relying on it.
const bannerTextColor = { color: 'var(--color-danger-text)' };

type ErrorStateBaseProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: string;
  message?: string;
  // 'page' (default) is a centered block for a page/section that failed to
  // load. 'banner' is the tinted inline box for a list that failed to load
  // inside an otherwise-working page.
  variant?: 'page' | 'banner';
};

type ErrorStateProps = ErrorStateBaseProps &
  (
    | { onRetry?: undefined; retryLabel?: undefined }
    // retryLabel is only required once a retry button actually renders — no
    // English default here, callers must supply a translated label rather
    // than silently leaking English into a Hebrew page.
    | { onRetry: () => void; retryLabel: string }
  );

export function ErrorState({ title, message, variant = 'page', retryLabel, onRetry, className, ...rest }: ErrorStateProps) {
  return (
    <div
      className={[styles.container, variant === 'banner' && styles.banner, variant === 'banner' && 'tone-danger', className]
        .filter(Boolean)
        .join(' ')}
      role="alert"
      {...rest}
    >
      <Heading level={3} style={variant === 'banner' ? bannerTextColor : undefined}>
        {title}
      </Heading>
      {message && (
        <Text variant="caption" style={variant === 'banner' ? bannerTextColor : undefined}>
          {message}
        </Text>
      )}
      {onRetry && (
        <Button variant="secondary" size={variant === 'banner' ? 'sm' : 'md'} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
