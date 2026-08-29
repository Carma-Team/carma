/**
 * @file RawSampleRecorder.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Records the full, unthinned accel/gyro/GPS sample stream to a file for a
 * staged calibration session, tagged with a scenario and platform label.
 * @description
 * Nothing else in the SDK persists raw samples — SensorManager and PhoneUsageManager
 * hold only rolling windows of a few samples and discard them, and TripData carries
 * GPS waypoints thinned to ~1 point/2s with no IMU at all. This fills that gap for
 * staged sessions (phone handheld / on-seat / in-pocket / mounted, held still or
 * moved deliberately) where the raw stream itself is the deliverable, not a derived
 * event. Trip recording is untouched — this class is never wired into startTrip/stopTrip.
 * `scenario`/`platform` are caller-supplied plain strings; the SDK has no opinion on
 * what labels the host app uses.
 *
 * Samples reach disk while the session is still running, so an app kill or a crash
 * costs the last flush interval rather than the whole drive.
 */
import type { Directory as DirectoryType, File as FileType } from 'expo-file-system';

import { RawExportFailure } from '@/lib/driving-sdk/types';

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

const RECORDINGS_DIR_NAME = 'raw-recordings';

// Lines buffered before the file is rewritten. At the ~20 lines/s this records
// (accel 10 Hz + gyro 10 Hz + GPS well under 1 Hz) that is a flush roughly every
// 50 s, which is the most a crash can cost.
const FLUSH_EVERY_LINES = 1000;

// Hard ceiling on one session, ~2.7 h at the rate above and ~20 MB of NDJSON.
// A staged calibration session is minutes; anything approaching this is a session
// someone forgot to stop, and the cap is what keeps that off a full disk.
const MAX_SESSION_LINES = 200_000;

// Completed recordings kept on disk. Sessions are exported to a laptop and then
// dead, but the export can only happen after the fact — so a handful survive a
// restart rather than the one path that happened to stay in memory.
const MAX_KEPT_RECORDINGS = 5;

// expo-file-system and expo-sharing are resolved on first use rather than at module
// scope: this is a __DEV__-only calibration feature, and importing the SDK must not
// drag two native modules into every app start for it. Also what lets the SDK be
// imported at all where those native modules are absent (a test runner, SSR).
//
// `require`, not `await import()`: a real dynamic import survives the transform and
// then needs an ESM VM to evaluate, which the Jest environment is not. `require` is
// lazy in both Metro and Jest, which is the whole property being bought here.
let fileSystem: typeof import('expo-file-system') | null = null;
function fs(): typeof import('expo-file-system') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fileSystem ??= require('expo-file-system');
  return fileSystem!;
}

let sharing: typeof import('expo-sharing') | null = null;
function share(): typeof import('expo-sharing') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sharing ??= require('expo-sharing');
  return sharing!;
}

function recordingsDir(): DirectoryType {
  const { Directory, Paths } = fs();
  return new Directory(Paths.document, RECORDINGS_DIR_NAME);
}

/** `session_<epoch ms>` — the stamp is what orders a listing, so parse it back. */
function startedAtOf(file: FileType): number {
  const parsed = Number(file.name.replace(/^session_/, '').replace(/\.ndjson$/, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Recording files in a directory listing, newest first. Duck-typed rather than
 * `instanceof File`: `Directory.list()` returns both kinds, and the name is the only
 * thing either one is asked for here.
 */
function recordingsIn(dir: DirectoryType): FileType[] {
  return (dir.list() as FileType[])
    .filter((entry) => typeof entry.name === 'string' && entry.name.endsWith('.ndjson'))
    .sort((a, b) => startedAtOf(b) - startedAtOf(a));
}

export class RawSampleRecorder {
  private session: RawRecordingSession | null = null;
  // NDJSON lines for the active session. Held in full because a flush rewrites the
  // whole file: expo-file-system's File.write() replaces contents rather than
  // appending, and MAX_SESSION_LINES bounds what that can cost.
  // ponytail: whole-file rewrite per flush, O(n²) in bytes over a session. Fine at
  // this cap and cadence; move to file.open() + writeBytes if sessions get longer.
  private lines: string[] = [];
  private lastFlushedCount = 0;
  // Survives past stop() — exportAsync() shares the last completed recording, not
  // necessarily one that's still "active" (session is null again by the time you export).
  private lastFilePath: string | null = null;

  /**
   * Starts a session, creating the file up front so a partial recording exists on
   * disk from the first flush onward.
   *
   * Calling it while a session is already live returns that session untouched
   * rather than silently discarding its buffered samples.
   */
  public start(scenario: string, platform: string): RawRecordingSession {
    if (this.session) return this.session;

    const { File } = fs();
    const dir = recordingsDir();
    // idempotent: true — safe to call on every start(), whether or not an earlier
    // session already created this directory.
    dir.create({ idempotent: true });
    this.prune(dir);

    const sessionId = `session_${Date.now()}`;
    this.lines = [];
    this.lastFlushedCount = 0;
    // Joined by the File constructor, never by string concatenation: Directory.uri
    // already ends in a slash on Android and does not on iOS, so a hand-built path
    // is right on exactly one platform.
    const file = new File(dir, `${sessionId}.ndjson`);
    file.create({ overwrite: true });

    this.session = {
      sessionId,
      scenario,
      platform,
      startedAt: Date.now(),
      filePath: file.uri,
    };
    return this.session;
  }

  /** Flushes whatever is still buffered and ends the session. */
  public async stop(): Promise<RawRecordingSession | null> {
    const session = this.session;
    if (!session) return null;
    this.session = null;
    this.flush(session.filePath);
    this.lines = [];
    this.lastFlushedCount = 0;
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
    if (this.lines.length >= MAX_SESSION_LINES) return;
    this.lines.push(JSON.stringify(sample));
    if (this.lines.length - this.lastFlushedCount >= FLUSH_EVERY_LINES) {
      this.flush(this.session.filePath);
    }
  }

  /**
   * Writes the buffer to disk. Never throws: a failed flush (disk full, file
   * removed underneath us) must not tear down a running sensor callback or lose
   * the samples still in memory — the next flush retries the whole buffer, because
   * the flushed mark only advances on a write that actually landed.
   */
  private flush(filePath: string): void {
    if (this.lines.length === this.lastFlushedCount) return;
    try {
      const { File } = fs();
      const file = new File(filePath);
      file.write(this.lines.join('\n'));
      this.lastFlushedCount = this.lines.length;
    } catch (err) {
      console.error('[RawSampleRecorder] Flush failed — samples kept for the next attempt', err);
    }
  }

  /** Deletes all but the newest MAX_KEPT_RECORDINGS completed recordings. */
  private prune(dir: DirectoryType): void {
    try {
      recordingsIn(dir).slice(MAX_KEPT_RECORDINGS).forEach((file) => file.delete());
    } catch (err) {
      console.warn('[RawSampleRecorder] Could not prune old recordings', err);
    }
  }

  /**
   * Completed recordings on disk, newest first. The only way to reach a session
   * recorded before the last app restart — `lastFilePath` lives in memory and does not
   * survive one.
   */
  public listRecordings(): string[] {
    try {
      const dir = recordingsDir();
      if (!dir.exists) return [];
      return recordingsIn(dir).map((file) => file.uri);
    } catch (err) {
      console.warn('[RawSampleRecorder] Could not list recordings', err);
      return [];
    }
  }

  /** True between start() and stop() — lets a caller avoid tearing down shared sensors mid-session. */
  public isRecording(): boolean {
    return this.session !== null;
  }

  /**
   * Shares the most recent completed recording via the OS share sheet, falling back
   * to the newest file on disk when nothing was recorded in this app run.
   * 'none-recorded' and 'sharing-unavailable' were both a bare `null` before — a caller
   * couldn't tell "nothing to export" from "can't open the share sheet on this device".
   */
  public async exportAsync(): Promise<string | RawExportFailure> {
    const path = this.lastFilePath ?? this.listRecordings()[0] ?? null;
    if (!path) return { error: 'none-recorded' };
    const Sharing = share();
    if (!(await Sharing.isAvailableAsync())) return { error: 'sharing-unavailable' };
    await Sharing.shareAsync(path);
    return path;
  }
}
