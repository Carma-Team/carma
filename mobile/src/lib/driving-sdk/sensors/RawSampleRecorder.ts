/**
 * @file RawSampleRecorder.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Records the full, unthinned accel/gyro/GPS sample stream to a file for a
 * staged calibration session, tagged with a scenario and platform label.
 * @description
 * Nothing else in the SDK persists raw samples — SensorManager and PhoneUsageManager
 * hold only rolling windows of a few samples and discard them, and TripData carries
 * GPS waypoints thinned to ~1 point/5s with no IMU at all. This fills that gap for
 * staged sessions (phone handheld / on-seat / in-pocket / mounted, held still or
 * moved deliberately) where the raw stream itself is the deliverable, not a derived
 * event. Trip recording is untouched — this class is never wired into startTrip/stopTrip.
 * `scenario`/`platform` are caller-supplied plain strings; the SDK has no opinion on
 * what labels the host app uses.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type RawSampleKind = 'accel' | 'gyro' | 'location';

export interface RawSample {
  t: number; // Date.now() ms, stamped per-sample — not batched under one shared tick
  kind: RawSampleKind;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
  location?: { lat: number; lng: number; speed: number | null; accuracy: number | null };
}

export interface RawRecordingSession {
  sessionId: string;
  scenario: string;
  platform: string;
  startedAt: number;
  filePath: string;
}

const RECORDINGS_DIR = `${FileSystem.documentDirectory}raw-recordings/`;

export class RawSampleRecorder {
  private session: RawRecordingSession | null = null;
  // Buffered NDJSON lines for the active session. Written in one shot on stop() —
  // expo-file-system's writeAsStringAsync has no native append, so a per-sample write
  // would need a queue to serialize calls. A staged session runs minutes, not hours,
  // so a few thousand buffered lines cost nothing and avoid that machinery entirely.
  private lines: string[] = [];
  // Resolves once RECORDINGS_DIR exists — awaited before the write in stop() rather
  // than blocking start(), which stays synchronous like every other manager's start().
  private dirReady: Promise<void> = Promise.resolve();
  // Survives past stop() — exportAsync() shares the last completed recording, not
  // necessarily one that's still "active" (session is null again by the time you export).
  private lastFilePath: string | null = null;

  public start(scenario: string, platform: string): RawRecordingSession {
    const sessionId = `session_${Date.now()}`;
    this.lines = [];
    this.dirReady = FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true }).then(
      () => undefined,
      () => undefined, // directory already exists — not an error
    );
    this.session = {
      sessionId,
      scenario,
      platform,
      startedAt: Date.now(),
      filePath: `${RECORDINGS_DIR}${sessionId}.ndjson`,
    };
    return this.session;
  }

  /** Flushes the buffered samples to disk and ends the session. Async because the write is. */
  public async stop(): Promise<RawRecordingSession | null> {
    const session = this.session;
    if (!session) return null;
    this.session = null;
    await this.dirReady;
    await FileSystem.writeAsStringAsync(session.filePath, this.lines.join('\n'));
    this.lines = [];
    this.lastFilePath = session.filePath;
    return session;
  }

  public pushAccelSample(x: number, y: number, z: number): void {
    this.push({ t: Date.now(), kind: 'accel', accel: { x, y, z } });
  }

  public pushGyroSample(x: number, y: number, z: number): void {
    this.push({ t: Date.now(), kind: 'gyro', gyro: { x, y, z } });
  }

  public pushLocationSample(lat: number, lng: number, speed: number | null, accuracy: number | null): void {
    this.push({ t: Date.now(), kind: 'location', location: { lat, lng, speed, accuracy } });
  }

  private push(sample: RawSample): void {
    if (!this.session) return; // no-op outside an active session — callers wire this unconditionally
    this.lines.push(JSON.stringify(sample));
  }

  public getFilePath(): string | null {
    return this.session?.filePath ?? this.lastFilePath;
  }

  /** Shares the last completed recording via the OS share sheet. Null if nothing was ever recorded. */
  public async exportAsync(): Promise<string | null> {
    if (!this.lastFilePath) return null;
    if (!(await Sharing.isAvailableAsync())) return null;
    await Sharing.shareAsync(this.lastFilePath);
    return this.lastFilePath;
  }
}
