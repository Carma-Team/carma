import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders as an alert with the title and message, page variant by default', () => {
    render(<ErrorState title="Something went wrong" message="Please try again." />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('Please try again.');
  });

  it('renders a retry button and fires onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" onRetry={onRetry} retryLabel="Retry" />);
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the tinted inline banner variant for a list that failed to load', () => {
    render(<ErrorState title="Could not load redemptions" variant="banner" onRetry={vi.fn()} retryLabel="Retry" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load redemptions');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
