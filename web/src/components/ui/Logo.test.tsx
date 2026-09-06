import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo, BrandMark } from './Logo';

describe('Logo', () => {
  it('renders the full wordmark with a CARMA accessible name', () => {
    render(<Logo height={20} />);
    expect(screen.getByRole('img', { name: 'CARMA' })).toBeInTheDocument();
  });

  it('switches to the white asset for a dark/photographic background', () => {
    render(<Logo tone="white" />);
    const img = screen.getByRole('img', { name: 'CARMA' });
    expect(img.getAttribute('src')).toContain('white');
  });
});

describe('BrandMark', () => {
  it('renders as decorative (no accessible name)', () => {
    const { container } = render(<BrandMark />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
  });

  it('adds the pulse animation class only when animated', () => {
    const { container, rerender } = render(<BrandMark />);
    expect(container.querySelector('img')?.className).not.toContain('carma-brandmark-pulse');

    rerender(<BrandMark animated />);
    expect(container.querySelector('img')?.className).toContain('carma-brandmark-pulse');
  });
});
