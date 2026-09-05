import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and message', () => {
    render(<EmptyState title="No rewards yet" message="Create your first reward." />);
    expect(screen.getByText('No rewards yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first reward.')).toBeInTheDocument();
  });

  it('renders an optional decorative icon', () => {
    render(<EmptyState title="No rewards yet" icon={<svg data-testid="gift-icon" />} />);
    expect(screen.getByTestId('gift-icon')).toBeInTheDocument();
    expect(screen.getByTestId('gift-icon').closest('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('omits the icon bubble entirely when no icon is given', () => {
    const { container } = render(<EmptyState title="No rewards yet" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });
});
