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

  it('reports (null, null) while only one of the two fields has a value — an incomplete pair is never eligible for submission', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.0648' } });

    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it('commits the pair once both fields hold a valid, in-range value', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '32.0648' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '34.7748' } });

    expect(onChange).toHaveBeenLastCalledWith(32.0648, 34.7748);
  });

  it('reports (null, null) for an out-of-range latitude — never committed, even with a valid longitude present', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '132.5' } }); // outside [-90, 90]

    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it('reports (null, null) for an out-of-range longitude the same way', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={null} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '181' } }); // outside [-180, 180]

    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it('never commits a non-finite value (e.g. "Infinity") — a number input reports it as empty by its own constraint validation, and the empty-field path already rejects it', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={null} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: 'Infinity' } });

    // `<input type="number">` cannot hold "Infinity" as a value at all — the
    // DOM reports it as badInput/empty, so no change is observed here; the
    // underlying rejection is proven directly in coordinates.test.ts and by
    // geocodeAddress's own "malformed provider result" tests, which reach
    // isValidLatitude/isValidLongitude with real non-finite numbers.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Latitude')).toHaveValue(null);
  });

  // ── the divergence bug: display and submission eligibility must never disagree ──

  it('invalidates immediately when a previously valid field is cleared — display and eligibility never diverge', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '' } });

    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(screen.getByLabelText('Latitude')).toHaveValue(null);
  });

  it('invalidates immediately when a previously valid field is edited to an out-of-range value', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '999' } });

    expect(onChange).toHaveBeenLastCalledWith(null, null);
    // The invalid draft stays visible — it is not silently reverted to the
    // last-known-good value, which would itself hide the problem.
    expect(screen.getByLabelText('Longitude')).toHaveValue(999);
  });

  it('re-commits a fresh valid pair after an edit that had invalidated the previous one', () => {
    const onChange = vi.fn();
    render(<LocationConfirmMap latitude={32.0648} longitude={34.7748} onChange={onChange} latLabel="Latitude" lngLabel="Longitude" />);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '999' } });
    expect(onChange).toHaveBeenLastCalledWith(null, null);

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '31.5' } });

    expect(onChange).toHaveBeenLastCalledWith(31.5, 34.7748);
  });
});
