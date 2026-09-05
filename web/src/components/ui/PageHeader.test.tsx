import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Rewards" />);
    expect(screen.getByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
  });

  it('renders an optional subtitle and actions', () => {
    render(<PageHeader title="Rewards" subtitle="24 rewards" actions={<button>New reward</button>} />);
    expect(screen.getByText('24 rewards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reward' })).toBeInTheDocument();
  });

  it('renders breadcrumbs in order, with the last crumb as plain text', () => {
    render(<PageHeader title="Rewards" breadcrumbs={[{ label: 'Management', href: '/management' }, { label: 'Rewards' }]} />);
    expect(screen.getByRole('link', { name: 'Management' })).toHaveAttribute('href', '/management');
    expect(screen.getByText('Rewards', { selector: 'span' })).toBeInTheDocument();
  });

  it('omits the breadcrumb nav entirely when none are given', () => {
    render(<PageHeader title="Rewards" />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
