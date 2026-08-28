import { useCallback, type ChangeEvent } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L, { type LeafletMouseEvent, type Marker as LeafletMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Input } from '@/components/ui';
import styles from './LocationConfirmMap.module.css';

// No paid vendor, no API key — OpenStreetMap's standard tile server under its
// fair-use policy (https://operations.osmfoundation.org/policies/tiles/),
// the same provider used for the address geocode itself.
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
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

type LocationConfirmMapProps = {
  latitude: number;
  longitude: number;
  // Whether `latitude`/`longitude` is a real geocode result (centers and
  // zooms on it) or just the no-match fallback center (zooms out, since
  // that point carries no meaning yet and must not look like an answer).
  hasMatch: boolean;
  onChange: (lat: number, lng: number) => void;
  latLabel: string;
  lngLabel: string;
};

// This is the *correction* step, not the primary way to give a location —
// CAR-203's address text field already did that. The map exists only so an
// applicant can see and fix a wrong or missing geocode; it never appears
// before an address has been typed, and it never centers on the device's
// own location.
export function LocationConfirmMap({ latitude, longitude, hasMatch, onChange, latLabel, lngLabel }: LocationConfirmMapProps) {
  const center: [number, number] = hasMatch ? [latitude, longitude] : ISRAEL_CENTER;

  const handleLatChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const lat = Number(event.target.value);
      if (event.target.value !== '' && !Number.isNaN(lat)) onChange(lat, longitude);
    },
    [longitude, onChange],
  );
  const handleLngChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const lng = Number(event.target.value);
      if (event.target.value !== '' && !Number.isNaN(lng)) onChange(latitude, lng);
    },
    [latitude, onChange],
  );

  return (
    <div className={styles.container}>
      <div className={styles.mapWrapper}>
        <MapContainer center={center} zoom={hasMatch ? CONFIRM_ZOOM : NO_MATCH_ZOOM} className={styles.mapContainer}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={onChange} />
          <Marker
            position={[latitude, longitude]}
            icon={markerIcon}
            draggable
            eventHandlers={{
              dragend: (event) => {
                const marker = event.target as LeafletMarker;
                const position = marker.getLatLng();
                onChange(position.lat, position.lng);
              },
            }}
          />
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
          value={latitude}
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
          value={longitude}
          onChange={handleLngChange}
        />
      </div>
    </div>
  );
}
