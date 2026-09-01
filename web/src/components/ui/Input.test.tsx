import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('associates the error message with the input via aria-describedby', () => {
    render(<Input label="Email" error="Invalid email" />);

    const input = screen.getByLabelText('Email');
    const errorEl = screen.getByText('Invalid email');

    expect(errorEl.id).toBeTruthy();
    expect(input).toHaveAttribute('aria-describedby', errorEl.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('has no aria-describedby when there is no error', () => {
    render(<Input label="Email" />);

    const input = screen.getByLabelText('Email');

    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  // CAR-118 review's small completion items: a submit-time validation
  // failure must be announced the moment it appears, not only when the
  // field happens to already be focused.
  it('announces the error message as an alert', () => {
    render(<Input label="Code" error="Required" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});
