import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './Switch';

describe('Switch', () => {
  it('renders as an accessible switch tied to its label', () => {
    render(<Switch label="Active" checked readOnly />);

    const toggle = screen.getByRole('switch', { name: 'Active' });
    expect(toggle).toBeChecked();
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Switch label="Active" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Active' }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
