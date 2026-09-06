import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingState, Skeleton } from './LoadingState';

describe('LoadingState', () => {
  it('renders an inline spinner by default with its label', () => {
    render(<LoadingState label="Loading…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('renders the brand mark instead of the spinner for the page variant', () => {
    const { container } = render(<LoadingState label="Loading…" variant="page" />);
    expect(container.querySelector('img[alt=""]')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});

describe('Skeleton', () => {
  it('renders a shimmer block sized by its props', () => {
    const { container } = render(<Skeleton width={120} height={16} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('16px');
  });

  it('defaults to full width', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('100%');
  });
});
