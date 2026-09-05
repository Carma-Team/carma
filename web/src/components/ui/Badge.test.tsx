import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, CountBadge } from './Badge';

describe('StatusBadge', () => {
  it('renders its label', () => {
    render(<StatusBadge tone="success">Active</StatusBadge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('CountBadge', () => {
  it('renders a count', () => {
    render(<CountBadge>24</CountBadge>);
    expect(screen.getByText('24')).toBeInTheDocument();
  });
});
