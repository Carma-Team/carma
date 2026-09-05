import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders the label and value', () => {
    render(<MetricCard label="Redemptions" value={1204} />);
    expect(screen.getByText('Redemptions')).toBeInTheDocument();
    expect(screen.getByText('1204')).toBeInTheDocument();
  });

  it('renders an optional hint and trend', () => {
    render(<MetricCard label="Redemptions" value={1204} hint="Last 30 days" trend="+12%" />);
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('omits the hint and trend when not given', () => {
    render(<MetricCard label="Redemptions" value={1204} />);
    expect(screen.queryByText('Last 30 days')).not.toBeInTheDocument();
  });
});
