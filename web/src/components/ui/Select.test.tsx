import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  it('associates the error message with the select via aria-describedby', () => {
    render(
      <Select label="Category" error="Required">
        <option value="a">A</option>
      </Select>,
    );

    const select = screen.getByLabelText('Category');
    const errorEl = screen.getByRole('alert');

    expect(select).toHaveAttribute('aria-describedby', errorEl.id);
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });
});
