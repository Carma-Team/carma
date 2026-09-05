import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders a warning message without treating it as invalid', () => {
    render(<Input label="Expires" warning="Expires in 7 days" />);

    const input = screen.getByLabelText('Expires');
    expect(screen.getByText('Expires in 7 days')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('renders a success message without treating it as invalid', () => {
    render(<Input label="Registration number" success="Verified against the registry." />);

    const input = screen.getByLabelText('Registration number');
    expect(screen.getByText('Verified against the registry.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('falls back to plain helper text when there is no validation status', () => {
    render(<Input label="Title" helperText="Shown to drivers in the app." />);

    expect(screen.getByText('Shown to drivers in the app.')).toBeInTheDocument();
  });

  it('renders a leading icon for the search variant', () => {
    render(<Input label="Search" variant="search" leadingIcon={<svg data-testid="search-icon" />} />);

    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
  });

  it('toggles a password field to visible text via the reveal button, and back', () => {
    render(
      <Input label="Password" type="password" defaultValue="carma1234" revealPasswordLabel="Show" hidePasswordLabel="Hide" />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not render a reveal button when no translated labels are supplied', () => {
    render(<Input label="Password" type="password" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
