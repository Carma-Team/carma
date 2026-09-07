import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>content</Card>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('accepts a sunken variant without dropping the default rendering', () => {
    render(<Card variant="sunken">nested summary</Card>);
    expect(screen.getByText('nested summary')).toBeInTheDocument();
  });
});
