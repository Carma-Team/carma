/**
 * @file RawSampleRecorder.ts
 * @owner May Hajbi — driving-sdk maintainer
 * @brief Records the full, unthinned accel/gyro/magnetometer/GPS sample stream to a
 * file for a staged calibration session, tagged with a scenario and platform label.
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
 *
 * The magnetometer is the one stream this class subscribes to itself rather than
 * receiving through a push* method. The accel and gyro taps exist because SensorManager
 * already holds those subscriptions open for event detection, so a second consumer taps
 * them instead of powering the same sensor twice. Nothing in the SDK detects anything
 * from the magnetometer, so there is no such subscription to tap — owning it here ties
 * its lifetime to the staged session rather than to every trip, which is what keeps a
 * normal trip free of magnetometer subscriptions (CAR-295).
 */
import type { Directory as DirectoryType, File as FileType } from 'expo-file-system';
import { Magnetometer } from 'expo-sensors';

import { RawExportFailure } from '@/lib/driving-sdk/types';

export type RawSampleKind = 'accel' | 'gyro' | 'mag' | 'location';

export interface RawSample {
  t: number; // Date.now() ms, stamped per-sample — not batched under one shared tick
  kind: RawSampleKind;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
  mag?: { x: number; y: number; z: number }; // microtesla
  location?: { lat: number; lng: number; speed: number | null; accuracy: number | null };
}

export interface RawRecordingSession {
  sessionId: string;
  scenario: string;
  platform: string;
  startedAt: number;
  filePath: string;
}

/**
 * The first line of every recording (CAR-212, `docs/raw-recording-storage.md`). The
 * upload route reads the index out of it and refuses a file without one, so it is
 * written by start() rather than assembled by whoever uploads: two sources for one
 * fact drift, and the file outlives the table.
 */
export interface RawSessionHeader {
  kind: 'session_start';
  version: 1;
  sessionId: string;
  startedAt: number;
  scenario: string;
  platform: string;
  deviceModel: string;
}

/**
 * An operator-placed point in the stream — "a hard brake happened here", or a change
 * of scenario mid-drive. Free-form on purpose: a marker is a label for offline
 * analysis, and the SDK has no opinion on the vocabulary, exactly as with `scenario`.
 */
export interface RawMarker {
  t: number;
  kind: 'marker';
  markerType: string;
  label: string;
  metadata?: Record<string, unknown>;
}

const RECORDINGS_DIR_NAME = 'raw-recordings';

// Format version carried on the header line. Bumped only when a reader written for
// the old shape would misread the new one — the server keys its parsing off it.
const FORMAT_VERSION = 1;

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

/**
 * UTF-8 bytes for a string. Hand-written rather than `TextEncoder`, which Hermes does
 * not guarantee, and rather than borrowing the app's — the SDK owns no dependency on
 * CARMA. Sample lines are ASCII, but a scenario, a device name or a marker label comes
 * from the host and can be anything.
 *
 * `codePointAt` rather than `charCodeAt`: a surrogate pair written as two three-byte
 * sequences is CESU-8, not UTF-8, and one emoji in a device name would leave the file
 * undecodable for a reader that validates.
 */
function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      i++; // the low surrogate is part of the code point just written
    }
  }
  return new Uint8Array(out);
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
  // NDJSON lines for the active session. Held in full even though a flush now appends
  // only the new ones: a failed flush retries the whole pending range, and nothing is
  // dropped until it lands. MAX_SESSION_LINES bounds what that can cost in memory.
  private lines: string[] = [];
  private lastFlushedCount = 0;
  // Bytes of this file a flush is known to have landed. The append offset comes from
  // here rather than from the file's own length: a write that failed part-way left
  // bytes on disk belonging to the chunk about to be retried, and appending after them
  // welds a partial line onto a whole copy of itself. Writing over them is what makes
  // the retry self-healing, the way the old whole-file rewrite was (CAR-304).
  private flushedBytes = 0;
  // Buffer length at which the next flush is attempted. Advances on every attempt,
  // successful or not: keyed off lastFlushedCount instead, a failed flush would leave
  // the interval permanently crossed and rewrite the whole file on every sample after
  // it — a synchronous write at 20 Hz for the rest of the session.
  private nextFlushAt = FLUSH_EVERY_LINES;
  // Survives past stop() — exportAsync() shares the last completed recording, not
  // necessarily one that's still "active" (session is null again by the time you export).
  private lastFilePath: string | null = null;
  // Structurally typed rather than imported: expo-sensors' subscription type has moved
  // between SDK versions, and `remove` is the only member this class ever calls.
  private magSub: { remove: () => void } | null = null;

  /**
   * Starts a session, creating the file up front so a partial recording exists on
   * disk from the first flush onward.
   *
   * Calling it while a session is already live returns that session untouched
   * rather than silently discarding its buffered samples.
   */
  public start(scenario: string, platform: string, deviceModel = 'unknown'): RawRecordingSession {
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
    this.flushedBytes = 0;
    this.nextFlushAt = FLUSH_EVERY_LINES;
    // Joined by the File constructor, never by string concatenation: Directory.uri
    // already ends in a slash on Android and does not on iOS, so a hand-built path
    // is right on exactly one platform.
    const file = new File(dir, `${sessionId}.ndjson`);
    file.create({ overwrite: true });

    const startedAt = Date.now();
    this.session = {
      sessionId,
      scenario,
      platform,
      startedAt,
      filePath: file.uri,
    };

    // First line, before any sample can be pushed. The upload route refuses a file
    // whose first line is not this, so it cannot be written lazily on the first flush.
    const header: RawSessionHeader = {
      kind: 'session_start',
      version: FORMAT_VERSION,
      sessionId,
      startedAt,
      scenario,
      platform,
      deviceModel,
    };
    this.lines.push(JSON.stringify(header));

    // Requested at 10 Hz, the same as the accel and gyro streams, so magnetometer samples
    // interleave on one timeline instead of needing to be resampled before analysis. It is
    // a request, not a guarantee: a staged Android session measured 8.6 Hz against the
    // accelerometer's 9.3 in the same window. Ask for a shorter interval only if the
    // rail-detection research needs more band than that leaves.
    // No isAvailableAsync() check: a handset without a magnetometer simply produces no
    // 'mag' lines, and absence is the honest report — zeros would not be.
    Magnetometer.setUpdateInterval(100);
    this.magSub = Magnetometer.addListener(({ x, y, z }) => {
      this.push({ t: Date.now(), kind: 'mag', mag: { x, y, z } });
    });
    return this.session;
  }

  /**
   * Flushes whatever is still buffered and ends the session.
   *
   * Throws if that last flush fails, and leaves the session running when it does:
   * this is the one flush with no next attempt behind it, so the samples only exist
   * in memory. Reporting success would clear them and point Export at a truncated
   * file — or, for a session under one flush interval, at an empty one. A caller
   * that catches this can retry stop() with the buffer intact.
   */
  public async stop(): Promise<RawRecordingSession | null> {
    const session = this.session;
    if (!session) return null;
    if (!this.flush(session.filePath)) {
      throw new Error('[RawSampleRecorder] Could not write the session — it is still recording');
    }
    this.session = null;
    this.magSub?.remove();
    this.magSub = null;
    this.lines = [];
    this.lastFlushedCount = 0;
    this.flushedBytes = 0;
    this.nextFlushAt = FLUSH_EVERY_LINES;
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

  /**
   * Places a labelled point in the stream. `label` defaults to the type, which is what
   * a quick-action button wants — the type is the label there, and metadata is for the
   * rare marker that carries a value with it.
   *
   * Returns false when the marker was not recorded — no session running, or a session
   * already at MAX_SESSION_LINES — so a caller can tell "recorded" from "dropped"
   * without reaching for `isRecording()` first and racing it.
   */
  public pushMarker(markerType: string, label = markerType, metadata?: Record<string, unknown>): boolean {
    return this.pushLine({ t: Date.now(), kind: 'marker', markerType, label, ...(metadata ? { metadata } : {}) });
  }

  /**
   * Re-labels the rest of the session. One staged drive can then cover mounted and then
   * hand-held without stopping: the marker says where the change happened, so an offline
   * reader can split the file on it, and the session's own label follows the current
   * state rather than the one it opened with.
   *
   * The `session_start` header is left alone: it is the file's first line, the upload
   * route reads the index out of it, and rewriting a line the rest of the file sits
   * behind is not an append. A mixed drive is therefore indexed under the scenario it
   * opened with, and a server-side filter on scenario returns it under that label only
   * — the marker in the stream is what carries the change to whoever analyses it.
   */
  public changeScenario(scenario: string): boolean {
    if (!this.session || scenario === this.session.scenario) return false;
    this.pushMarker('scenario_change', scenario, { from: this.session.scenario, to: scenario });
    this.session = { ...this.session, scenario };
    return true;
  }

  private push(sample: RawSample): void {
    this.pushLine(sample);
  }

  /** False when the entry was dropped: no session, or a session already at its cap. */
  private pushLine(entry: RawSample | RawMarker): boolean {
    if (!this.session) return false; // no-op outside an active session — callers wire this unconditionally
    if (this.lines.length >= MAX_SESSION_LINES) return false;
    this.lines.push(JSON.stringify(entry));
    if (this.lines.length >= this.nextFlushAt) {
      this.nextFlushAt = this.lines.length + FLUSH_EVERY_LINES;
      this.flush(this.session.filePath);
    }
    return true;
  }

  /**
   * Writes the buffer to disk and reports whether it landed. Never throws: a failed
   * flush (disk full, file removed underneath us) must not tear down a running sensor
   * callback or lose the samples still in memory — the next flush retries the whole
   * buffer, because the flushed mark only advances on a write that actually landed.
   *
   * The return value is what lets stop() tell a saved session from a lost one; a
   * mid-session flush has a next attempt to fall back on and ignores it.
   */
  private flush(filePath: string): boolean {
    if (this.lines.length === this.lastFlushedCount) return true;
    try {
      const { File } = fs();
      const file = new File(filePath);
      // Only the lines added since the last successful flush. Rewriting the whole file
      // cost bytes quadratic in the session and ran synchronously inside a sensor
      // callback, so a late flush blocked the JS thread long enough to drop the very
      // samples being recorded (CAR-304).
      const pending = this.lines.slice(this.lastFlushedCount);
      // The separator goes before each appended line rather than after: a trailing
      // newline would leave a stopped session ending in an empty line, and the upload
      // route reads this file line by line.
      const chunk = (this.lastFlushedCount === 0 ? '' : '\n') + pending.join('\n');
      const bytes = utf8Bytes(chunk);
      const handle = file.open();
      try {
        handle.offset = this.flushedBytes;
        handle.writeBytes(bytes);
      } finally {
        handle.close();
      }
      this.flushedBytes += bytes.length;
      this.lastFlushedCount = this.lines.length;
      return true;
    } catch (err) {
      console.error('[RawSampleRecorder] Flush failed — samples kept for the next attempt', err);
      return false;
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
   *
   * The live session's file is created by start() and flushed into while it records, so
   * it is on disk from the first moment and would otherwise head this list. It is left
   * out because every consumer reads a listed file as a finished drive: exporting or
   * uploading one mid-session ships a truncated prefix under the session's own id, and
   * it is then the complete drive that can no longer be stored under that id.
   */
  public listRecordings(): string[] {
    try {
      const dir = recordingsDir();
      if (!dir.exists) return [];
      const live = this.session?.filePath;
      return recordingsIn(dir)
        .map((file) => file.uri)
        .filter((uri) => uri !== live);
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
   * Shares a recording via the OS share sheet. With no path it takes the most recent
   * completed session, falling back to the newest file on disk when nothing was recorded
   * in this app run; with one it shares exactly that file, which is how a session from an
   * earlier app run becomes reachable at all (CAR-305).
   * 'none-recorded' and 'sharing-unavailable' were both a bare `null` before — a caller
   * couldn't tell "nothing to export" from "can't open the share sheet on this device".
   */
  public async exportAsync(filePath?: string): Promise<string | RawExportFailure> {
    const path = filePath ?? this.lastFilePath ?? this.listRecordings()[0] ?? null;
    if (!path) return { error: 'none-recorded' };
    const Sharing = share();
    if (!(await Sharing.isAvailableAsync())) return { error: 'sharing-unavailable' };
    await Sharing.shareAsync(path);
    return path;
  }
}
