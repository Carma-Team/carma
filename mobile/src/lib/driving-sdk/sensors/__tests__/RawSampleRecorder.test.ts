import { RawSampleRecorder } from '@/lib/driving-sdk/sensors/RawSampleRecorder';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// expo-file-system's class-based File/Directory API (SDK 54+) is entirely
// synchronous — only expo-sharing's export step is actually async.
// jest.mock() calls are hoisted above this import regardless of source position
// (babel-plugin-jest-hoist), so writing the import first here is safe and keeps
// eslint's import/first happy.

// A one-directory in-memory filesystem: path → contents. The recorder now lists,
// prunes and re-reads its own directory, so a mock that only records calls cannot
// tell whether any of that works.
const fs = new Map<string, string>();
// The recorder appends through a file handle rather than rewriting (CAR-304), so this
// is what a flush now calls — once per flush, with only the lines added since the last.
const mockFileAppend = jest.fn((_chunk: string) => undefined);
const mockDirCreate = jest.fn((_opts?: { idempotent?: boolean }) => undefined);
const mockFileCreate = jest.fn((_opts?: { overwrite?: boolean }) => undefined);

// `Paths.document` ends in a slash and so does Directory.uri on Android
// (FileSystemDirectory.kt:105) — but not on iOS. The real File constructor joins
// without caring; anything hand-concatenating a '/' produces a doubled separator
// here, which is exactly the defect this mock now exposes.
const DOCUMENT_DIR = 'file:///docs/';

function join(parts: (string | { uri: string })[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`);
}

// Plain constructor functions, not `class` — the class-declaration form doesn't
// survive this project's babel/jest-expo transform inside a jest.mock() factory
// ("X is not a constructor" at runtime otherwise).
function MockFile(this: any, ...parts: (string | { uri: string })[]) {
  this.uri = join(parts);
  this.name = this.uri.split('/').pop();
  Object.defineProperty(this, 'exists', { get: () => fs.has(this.uri) });
  this.create = (opts?: { overwrite?: boolean }) => {
    mockFileCreate(opts);
    fs.set(this.uri, '');
  };
  // Bytes are decoded back with fromCharCode: every line this recorder writes is JSON,
  // and the mock's `size` is in characters, so the two agree for the ASCII these tests
  // use. A test that needs multi-byte behaviour would need a real UTF-8 decode here.
  this.open = () => {
    const uri = this.uri;
    const handle = {
      get size() { return (fs.get(uri) ?? '').length; },
      offset: 0,
      writeBytes: (bytes: Uint8Array) => {
        // Built in a loop, not by spreading into fromCharCode: a retried flush carries
        // the whole pending range, which is six figures of bytes and overflows the
        // argument list.
        let chunk = '';
        for (let i = 0; i < bytes.length; i++) chunk += String.fromCharCode(bytes[i]);
        mockFileAppend(chunk);
        fs.set(uri, (fs.get(uri) ?? '').slice(0, handle.offset) + chunk);
      },
      close: () => undefined,
    };
    return handle;
  };
  this.delete = () => { fs.delete(this.uri); };
}

function MockDirectory(this: any, ...parts: (string | { uri: string })[]) {
  // Trailing slash on purpose — the Android shape, see DOCUMENT_DIR above.
  this.uri = `${join(parts)}/`;
  Object.defineProperty(this, 'exists', { get: () => true });
  this.create = (opts?: { idempotent?: boolean }) => mockDirCreate(opts);
  this.list = () =>
    [...fs.keys()]
      .filter((path) => path.startsWith(this.uri))
      .map((path) => new (MockFile as any)(path));
}

jest.mock('expo-file-system', () => ({
  Paths: { document: DOCUMENT_DIR },
  Directory: MockDirectory,
  File: MockFile,
}));

const mockIsAvailableAsync = jest.fn(async () => true);
const mockShareAsync = jest.fn(async (_uri: string) => undefined);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (uri: string) => mockShareAsync(uri),
}));

const DIR = 'file:///docs/raw-recordings/';
const mockMagSetInterval = jest.fn((_ms: number) => undefined);
const mockMagAddListener = jest.fn();
const mockMagRemove = jest.fn();
// Holds the callback the recorder registered, so a test can drive samples through it.
// Must be `mock`-prefixed: jest.mock factories may not reference other out-of-scope names.
let mockMagListener: ((s: { x: number; y: number; z: number }) => void) | null = null;

jest.mock('expo-sensors', () => ({
  Magnetometer: {
    setUpdateInterval: (ms: number) => mockMagSetInterval(ms),
    addListener: (cb: (s: { x: number; y: number; z: number }) => void) => {
      mockMagAddListener();
      mockMagListener = cb;
      return { remove: () => mockMagRemove() };
    },
  },
}));

describe('RawSampleRecorder', () => {
  let recorder: RawSampleRecorder;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.clear();
    mockMagListener = null;
    recorder = new RawSampleRecorder();
  });

  it('returns a session tagged with the caller-supplied scenario and platform', async () => {
    const session = recorder.start('handheld', 'ios');

    expect(session.scenario).toBe('handheld');
    expect(session.platform).toBe('ios');
    expect(session.filePath).toContain(session.sessionId);
    expect(mockDirCreate).toHaveBeenCalledWith({ idempotent: true });
  });

  // The path was built by concatenating '/' onto Directory.uri, which already ends
  // in one on Android and does not on iOS — so it was right on exactly one platform.
  it('joins the file path without doubling the directory separator', async () => {
    const session = recorder.start('handheld', 'android');

    expect(session.filePath).toBe(`${DIR}${session.sessionId}.ndjson`);
    // Only the `file://` scheme may hold a double slash — nowhere in the path itself.
    expect(session.filePath.replace('file://', '')).not.toContain('//');
  });

  it('drops samples pushed before start() or after stop()', async () => {
    recorder.pushAccelSample(1, 2, 3);
    expect(mockFileAppend).not.toHaveBeenCalled();

    const session = recorder.start('mounted', 'android');
    await recorder.stop();
    recorder.pushGyroSample(4, 5, 6);
    await recorder.stop();

    // The header is the only line: the sample before start() and the one after stop()
    // were both dropped, so the single flush had nothing else to write.
    const lines = fs.get(session.filePath)!.split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l: any) => l.kind)).toEqual(['session_start']);
  });

  it('writes one NDJSON line per pushed sample, tagged by kind', async () => {
    const session = recorder.start('in-pocket', 'ios');
    recorder.pushAccelSample(1, 2, 3);
    recorder.pushGyroSample(4, 5, 6);
    recorder.pushLocationSample(32.05, 34.77, 10, 5);

    await recorder.stop();

    const lines = fs.get(session.filePath)!.split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(4);
    expect(lines.map((l: any) => l.kind)).toEqual(['session_start', 'accel', 'gyro', 'location']);
    expect(lines[1].accel).toEqual({ x: 1, y: 2, z: 3 });
    expect(lines[3].location).toEqual({ lat: 32.05, lng: 34.77, speed: 10, accuracy: 5 });
  });

  // A crash or an app kill used to cost the whole session: nothing reached disk
  // until stop(). The file must hold samples while the session is still running.
  it('flushes to disk mid-session, before stop() is ever called', async () => {
    const session = recorder.start('handheld', 'ios');
    for (let i = 0; i < 1000; i++) recorder.pushAccelSample(i, 0, 0);

    // The header counts toward the interval, so the flush lands on the 999th sample.
    expect(fs.get(session.filePath)!.split('\n')).toHaveLength(1000);
    expect(recorder.isRecording()).toBe(true);
  });

  // A second start() reset `lines` with no guard, silently discarding a live session.
  it('returns the live session instead of restarting over it', async () => {
    const first = recorder.start('handheld', 'ios');
    recorder.pushAccelSample(1, 1, 1);

    const second = recorder.start('mounted', 'android');

    expect(second).toEqual(first);
    await recorder.stop();
    expect(fs.get(first.filePath)).toContain('"accel"');
  });

  it('exports the last completed recording via the share sheet', async () => {
    recorder.start('handheld', 'ios');
    recorder.pushAccelSample(1, 1, 1);
    const session = await recorder.stop();

    const result = await recorder.exportAsync();

    expect(mockShareAsync).toHaveBeenCalledWith(session!.filePath);
    expect(result).toBe(session!.filePath);
  });

  // lastFilePath lives in memory only, so before this every recording made in an
  // earlier app run was unreachable — orphaned on disk with no way to export it.
  it('falls back to the newest file on disk when nothing was recorded this run', async () => {
    fs.set(`${DIR}session_1000.ndjson`, 'old');
    fs.set(`${DIR}session_3000.ndjson`, 'newest');
    fs.set(`${DIR}session_2000.ndjson`, 'middle');

    const result = await recorder.exportAsync();

    expect(result).toBe(`${DIR}session_3000.ndjson`);
    expect(recorder.listRecordings()).toEqual([
      `${DIR}session_3000.ndjson`,
      `${DIR}session_2000.ndjson`,
      `${DIR}session_1000.ndjson`,
    ]);
  });

  it('prunes all but the five newest recordings when a session starts', async () => {
    for (let i = 1; i <= 7; i++) fs.set(`${DIR}session_${i}000.ndjson`, 'x');

    const session = recorder.start('handheld', 'ios');

    expect(fs.has(`${DIR}session_1000.ndjson`)).toBe(false);
    expect(fs.has(`${DIR}session_2000.ndjson`)).toBe(false);
    expect(fs.has(`${DIR}session_7000.ndjson`)).toBe(true);
    // The new session's own file is created after the prune, so it survives it.
    expect(fs.has(session.filePath)).toBe(true);
  });

  it('reports none-recorded when nothing was ever recorded', async () => {
    const result = await recorder.exportAsync();

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ error: 'none-recorded' });
  });

  it('reports sharing-unavailable distinctly from none-recorded when a recording exists', async () => {
    recorder.start('handheld', 'ios');
    await recorder.stop();
    mockIsAvailableAsync.mockResolvedValueOnce(false);

    const result = await recorder.exportAsync();

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ error: 'sharing-unavailable' });
  });

  // A failed flush must not throw out of a 10 Hz sensor callback, and must not
  // advance the flushed mark — the next flush retries the whole buffer.
  it('keeps buffered samples when a flush throws, and writes them on the next one', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const session = recorder.start('handheld', 'ios');

    mockFileAppend.mockImplementationOnce(() => { throw new Error('disk full'); });
    for (let i = 0; i < 1000; i++) recorder.pushAccelSample(i, 0, 0);
    expect(fs.get(session.filePath)).toBe(''); // the failed flush wrote nothing, header included

    // The retry comes one full interval later, not on the very next sample, and it
    // carries everything the failed flush was holding rather than only the new lines.
    for (let i = 1000; i < 2000; i++) recorder.pushAccelSample(i, 0, 0);

    expect(fs.get(session.filePath)!.split('\n')).toHaveLength(2000);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // A flush that keeps failing must not turn into a whole-file rewrite per sample.
  it('attempts one flush per interval while writes keep failing, not one per sample', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    recorder.start('handheld', 'ios');

    mockFileAppend.mockImplementation(() => { throw new Error('disk full'); });
    for (let i = 0; i < 3000; i++) recorder.pushAccelSample(i, 0, 0);

    expect(mockFileAppend).toHaveBeenCalledTimes(3);
    // clearAllMocks() clears calls but not implementations, so put the default back
    // rather than leaking a throwing write into every test after this one.
    mockFileAppend.mockImplementation(() => undefined);
    errorSpy.mockRestore();
  });

  // The last flush has no next attempt behind it, so a failure there is data loss and
  // must be reported rather than swallowed the way a mid-session one is.
  it('throws from stop() when the final flush fails, and keeps the session recording', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    recorder.start('handheld', 'ios');
    recorder.pushAccelSample(1, 2, 3);

    mockFileAppend.mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(recorder.stop()).rejects.toThrow();

    // Still recording, buffer intact, subscription alive — so Stop can be retried.
    expect(recorder.isRecording()).toBe(true);
    expect(mockMagRemove).not.toHaveBeenCalled();

    const session = await recorder.stop();

    expect(session).not.toBeNull();
    // Header plus the one sample — the retry carried everything the failed flush held.
    expect(fs.get(session!.filePath)!.split('\n')).toHaveLength(2);
    errorSpy.mockRestore();
  });

  // ── The CAR-212 format (CAR-303) ───────────────────────────────────────────
  // The upload route reads the recording's index out of this line and refuses a file
  // without one, so the header is the file's contract with the server, not decoration.

  it('opens the file with the session header the upload route reads', async () => {
    const session = recorder.start('mounted', 'ios', 'iPhone 14');
    recorder.pushAccelSample(1, 2, 3);

    await recorder.stop();

    const header = JSON.parse(fs.get(session.filePath)!.split('\n')[0]);
    expect(header).toEqual({
      kind: 'session_start',
      version: 1,
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      scenario: 'mounted',
      platform: 'ios',
      deviceModel: 'iPhone 14',
    });
  });

  it('records a marker in the stream, with the label defaulting to the type', async () => {
    const session = recorder.start('mounted', 'ios');
    expect(recorder.pushMarker('hard_brake')).toBe(true);
    expect(recorder.pushMarker('phone_pickup', 'Pickup', { seat: 'driver' })).toBe(true);

    await recorder.stop();

    const lines = fs.get(session.filePath)!.split('\n').map((l) => JSON.parse(l));
    expect(lines[1]).toMatchObject({ kind: 'marker', markerType: 'hard_brake', label: 'hard_brake' });
    expect(lines[2]).toMatchObject({
      kind: 'marker', markerType: 'phone_pickup', label: 'Pickup', metadata: { seat: 'driver' },
    });
  });

  it('reports a marker pushed with no session running rather than dropping it silently', () => {
    expect(recorder.pushMarker('hard_brake')).toBe(false);
  });

  // One drive can cover mounted and then hand-held without being split in two: the
  // marker says where the change happened and the session's own label follows it.
  it('re-labels the session on a scenario change, leaving a marker where it happened', async () => {
    const session = recorder.start('mounted', 'ios');
    expect(recorder.changeScenario('handheld')).toBe(true);

    await recorder.stop();

    const lines = fs.get(session.filePath)!.split('\n').map((l) => JSON.parse(l));
    expect(lines[1]).toMatchObject({
      kind: 'marker', markerType: 'scenario_change', label: 'handheld',
      metadata: { from: 'mounted', to: 'handheld' },
    });
    expect(recorder.listRecordings()[0]).toBe(session.filePath);
  });

  it('ignores a scenario change to the scenario already running', async () => {
    recorder.start('mounted', 'ios');

    expect(recorder.changeScenario('mounted')).toBe(false);
  });

  // ── Appending rather than rewriting (CAR-304) ──────────────────────────────

  it('appends only the lines added since the last flush', async () => {
    const session = recorder.start('handheld', 'ios');
    for (let i = 0; i < 1000; i++) recorder.pushAccelSample(i, 0, 0);
    const firstChunkLines = mockFileAppend.mock.calls[0][0].split('\n').length;

    await recorder.stop();

    // Two writes, and the second carries only what the first did not: a rewrite would
    // have made the second chunk as long as the whole session.
    expect(mockFileAppend).toHaveBeenCalledTimes(2);
    expect(firstChunkLines).toBe(1000);
    expect(mockFileAppend.mock.calls[1][0].split('\n').length).toBe(2);
    expect(fs.get(session.filePath)!.split('\n')).toHaveLength(1001);
  });

  // ── Reaching an older session (CAR-305) ────────────────────────────────────

  it('exports the session it was given rather than the newest one', async () => {
    fs.set(`${DIR}session_1000.ndjson`, 'old');
    fs.set(`${DIR}session_3000.ndjson`, 'newest');

    const result = await recorder.exportAsync(`${DIR}session_1000.ndjson`);

    expect(mockShareAsync).toHaveBeenCalledWith(`${DIR}session_1000.ndjson`);
    expect(result).toBe(`${DIR}session_1000.ndjson`);
  });

  // CAR-295 - magnetometer, the one stream the recorder subscribes to itself.

  it('serialises magnetometer samples alongside the pushed streams', async () => {
    const session = recorder.start('mounted', 'android');
    recorder.pushAccelSample(1, 2, 3);
    mockMagListener!({ x: 21.5, y: -8, z: 44.25 });

    await recorder.stop();

    const lines = fs.get(session.filePath)!.split('\n').map((l: string) => JSON.parse(l));
    expect(lines.map((l: any) => l.kind)).toEqual(['session_start', 'accel', 'mag']);
    expect(lines[2].mag).toEqual({ x: 21.5, y: -8, z: 44.25 });
    expect(mockMagSetInterval).toHaveBeenCalledWith(100);
  });

  it('opens no magnetometer subscription until a staged session starts', () => {
    expect(mockMagAddListener).not.toHaveBeenCalled();

    recorder.start('handheld', 'ios');

    expect(mockMagAddListener).toHaveBeenCalledTimes(1);
  });

  it('drops the magnetometer subscription on stop, so it cannot outlive the session', async () => {
    recorder.start('handheld', 'ios');
    await recorder.stop();

    expect(mockMagRemove).toHaveBeenCalledTimes(1);
  });

  // The live session is kept rather than replaced, so the second start() opens no
  // second subscription at all — there is nothing to leak and nothing to tear down.
  it('does not leak a subscription when start() is called twice without a stop()', () => {
    recorder.start('handheld', 'ios');
    recorder.start('on-seat', 'ios');

    expect(mockMagAddListener).toHaveBeenCalledTimes(1);
    expect(mockMagRemove).not.toHaveBeenCalled();
  });
});
