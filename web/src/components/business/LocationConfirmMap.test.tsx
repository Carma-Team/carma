import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationConfirmMap } from './LocationConfirmMap';

describe('LocationConfirmMap', () => {
  it('renders no marker when no valid position has been deliberately chosen yet', () => {
    render(<LocationConfirmMap latitude={null} longitude={null} onChange={vi.fn()} latLabel="Latitude" lngLabel="Longitude" />);

    // The fallback framing center must never be presented as a selected pin.
    expect(document.querySelector('.leaflet-marker-icon')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Latitude')).toHaveValue(null);
    expect(screen.getByLabelText('Longitude')).toHaveValue(null);
  });

  it('renders a marker once a valid position is supplied', () => {
    render(<LocationConfirmMap latitude={32.0648} longitude={34.7748} onChange={vi.fn()} latLabel="Latitude" lngLabel="Longitude" />);

    expect(document.querySelector('.leaflet-marker-icon')).toBeInTheDocument();
  });

  it('does not call onChange while only one of the two fields has a value — an incomplete pair is never committed', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.0648' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the pair once both fields hold a valid, in-range value', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.0648' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '34.7748' } });

    expect(onChange).toHaveBeenCalledWith(32.0648, 34.7748);
  });

  it('rejects an out-of-range latitude — never committed, even with a valid longitude present', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '132.5' } }); // outside [-90, 90]

    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range longitude the same way', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '181' } }); // outside [-180, 180]

    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a non-finite value typed directly (e.g. "Infinity")', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: 'Infinity' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clearing a previously valid field back to empty does not re-commit a stale pair', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '' } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
