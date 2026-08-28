import { useCallback, useState, type ChangeEvent } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L, { type LeafletMouseEvent, type Marker as LeafletMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidLatitude, isValidLongitude } from '@/lib/geo/coordinates';
import { Input } from '@/components/ui';
import styles from './LocationConfirmMap.module.css';

// No paid vendor, no API key — OpenStreetMap's standard tile server under its
// fair-use policy (https://operations.osmfoundation.org/policies/tiles/),
// the same provider used for the address geocode itself. Only ever the
// map's initial framing when nothing has been selected yet — never rendered
// as a pin, and never reported to the caller as a chosen location.
const ISRAEL_CENTER: [number, number] = [31.5, 34.75];
const NO_MATCH_ZOOM = 8;
const CONFIRM_ZOOM = 16;

// A plain CSS dot instead of Leaflet's default marker image — that default
// resolves relative to the package on disk, which breaks under a bundler
// unless every consumer remembers to re-point it (a well-known Leaflet/Vite
// trap). A div icon has no path to get wrong.
const markerIcon = L.divIcon({
  className: styles.marker,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      // Leaflet allows panning past +/-180deg longitude (world wrap); guard
      // it the same as a typed value, not just the keyboard path.
      if (isValidLatitude(event.latlng.lat) && isValidLongitude(event.latlng.lng)) {
        onPick(event.latlng.lat, event.latlng.lng);
      }
    },
  });
  return null;
}

// The single source of truth for "is this pair usable" — parsing an empty
// string with `Number()` yields 0, not NaN, so an empty/whitespace field is
// rejected explicitly rather than trusted to fail the range check.
function parseValidPair(latDraft: string, lngDraft: string): { lat: number; lng: number } | null {
  if (latDraft.trim() === '' || lngDraft.trim() === '') return null;
  const lat = Number(latDraft);
  const lng = Number(lngDraft);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  return { lat, lng };
}

type LocationConfirmMapProps = {
  // `null` means no complete, valid, deliberately-chosen position exists
  // yet — the map must not imply one by showing a pin.
  latitude: number | null;
  longitude: number | null;
  // Called on every edit, not only a valid one: `(null, null)` is how this
  // component reports "what's on screen right now cannot be submitted" —
  // see the module doc for why the parent must never hold onto a value
  // this component itself is no longer displaying.
  onChange: (lat: number | null, lng: number | null) => void;
  latLabel: string;
  lngLabel: string;
};

/**
 * This is the *correction* step, not the primary way to give a location —
 * CAR-203's address text field already did that. The map exists only so an
 * applicant can see and fix a wrong or missing geocode; it never appears
 * before an address has been typed, and it never centers on the device's
 * own location.
 *
 * Invariant: the parent's notion of "the current coordinate" is exactly
 * what this component displays, never a value from before the applicant's
 * latest edit. Earlier revisions tracked the typed drafts and the last
 * *valid* pair as two separate pieces of state — editing one field back to
 * something invalid left the draft showing the edit while the parent still
 * held the old, valid pair, so "Confirm and continue" stayed enabled and a
 * stale coordinate could reach submission. Every change here — a keystroke,
 * a map click, a drag — now calls `onChange` unconditionally, passing
 * `(null, null)` whenever the pair on screen is incomplete or invalid, so
 * the parent's state can never diverge from what the applicant is looking
 * at.
 */
export function LocationConfirmMap({ latitude, longitude, onChange, latLabel, lngLabel }: LocationConfirmMapProps) {
  const hasPosition = latitude !== null && longitude !== null;
  const center: [number, number] = hasPosition ? [latitude, longitude] : ISRAEL_CENTER;

  const [latDraft, setLatDraft] = useState(latitude !== null ? String(latitude) : '');
  const [lngDraft, setLngDraft] = useState(longitude !== null ? String(longitude) : '');

  const handleLatChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextDraft = event.target.value;
      setLatDraft(nextDraft);
      const pair = parseValidPair(nextDraft, lngDraft);
      onChange(pair?.lat ?? null, pair?.lng ?? null);
    },
    [lngDraft, onChange],
  );
  const handleLngChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextDraft = event.target.value;
      setLngDraft(nextDraft);
      const pair = parseValidPair(latDraft, nextDraft);
      onChange(pair?.lat ?? null, pair?.lng ?? null);
    },
    [latDraft, onChange],
  );

  const handlePick = useCallback(
    (lat: number, lng: number) => {
      // A map click/drag always supplies a complete, already-validated
      // pair (see ClickHandler and the dragend guard below) — no partial
      // state possible, so this always reports a real position.
      setLatDraft(String(lat));
      setLngDraft(String(lng));
      onChange(lat, lng);
    },
    [onChange],
  );

  return (
    <div className={styles.container}>
      <div className={styles.mapWrapper}>
        <MapContainer center={center} zoom={hasPosition ? CONFIRM_ZOOM : NO_MATCH_ZOOM} className={styles.mapContainer}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={handlePick} />
          {hasPosition && (
            <Marker
              position={[latitude, longitude]}
              icon={markerIcon}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const marker = event.target as LeafletMarker;
                  const position = marker.getLatLng();
                  if (isValidLatitude(position.lat) && isValidLongitude(position.lng)) {
                    handlePick(position.lat, position.lng);
                  }
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className={styles.coords}>
        <Input
          label={latLabel}
          type="number"
          step="any"
          min={-90}
          max={90}
          dir="ltr"
          required
          value={latDraft}
          onChange={handleLatChange}
        />
        <Input
          label={lngLabel}
          type="number"
          step="any"
          min={-180}
          max={180}
          dir="ltr"
          required
          value={lngDraft}
          onChange={handleLngChange}
        />
      </div>
    </div>
  );
}
