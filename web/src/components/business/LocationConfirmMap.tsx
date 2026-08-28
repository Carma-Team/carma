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

type LocationConfirmMapProps = {
  // `null` means no complete, valid, deliberately-chosen position exists
  // yet — the map must not imply one by showing a pin.
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  latLabel: string;
  lngLabel: string;
};

// This is the *correction* step, not the primary way to give a location —
// CAR-203's address text field already did that. The map exists only so an
// applicant can see and fix a wrong or missing geocode; it never appears
// before an address has been typed, and it never centers on the device's
// own location.
export function LocationConfirmMap({ latitude, longitude, onChange, latLabel, lngLabel }: LocationConfirmMapProps) {
  const hasPosition = latitude !== null && longitude !== null;
  const center: [number, number] = hasPosition ? [latitude, longitude] : ISRAEL_CENTER;

  // Local drafts, separate from the confirmed `latitude`/`longitude` props:
  // a coordinate is only ever reported to the parent once BOTH fields parse
  // to a finite, in-range number together. Typing "-" while writing "-31.5",
  // or clearing one field mid-edit, must not blank the other field's value
  // or silently commit a half-typed pair.
  const [latDraft, setLatDraft] = useState(latitude !== null ? String(latitude) : '');
  const [lngDraft, setLngDraft] = useState(longitude !== null ? String(longitude) : '');

  const commitIfComplete = useCallback(
    (nextLatDraft: string, nextLngDraft: string) => {
      if (nextLatDraft.trim() === '' || nextLngDraft.trim() === '') return;
      const lat = Number(nextLatDraft);
      const lng = Number(nextLngDraft);
      if (isValidLatitude(lat) && isValidLongitude(lng)) onChange(lat, lng);
    },
    [onChange],
  );

  const handleLatChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setLatDraft(event.target.value);
      commitIfComplete(event.target.value, lngDraft);
    },
    [lngDraft, commitIfComplete],
  );
  const handleLngChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setLngDraft(event.target.value);
      commitIfComplete(latDraft, event.target.value);
    },
    [latDraft, commitIfComplete],
  );

  const handlePick = useCallback(
    (lat: number, lng: number) => {
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
