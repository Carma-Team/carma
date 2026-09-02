import { RawSampleRecorder } from '@/lib/driving-sdk/sensors/RawSampleRecorder';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// expo-file-system's class-based File/Directory API (SDK 54+) is entirely
// synchronous — only expo-sharing's export step is actually async.
// jest.mock() calls are hoisted above this import regardless of source position
// (babel-plugin-jest-hoist), so writing the import first here is safe and keeps
// eslint's import/first happy.

const mockDirCreate = jest.fn((_opts?: { idempotent?: boolean }) => undefined);
const mockFileCreate = jest.fn((_opts?: { overwrite?: boolean }) => undefined);
const mockFileWrite = jest.fn((_content: string) => undefined);

// Plain constructor functions, not `class` — the class-declaration form doesn't
// survive this project's babel/jest-expo transform inside a jest.mock() factory
// ("X is not a constructor" at runtime otherwise).
function MockDirectory(this: any) {
  this.uri = 'file:///docs/raw-recordings';
  this.create = (opts?: { idempotent?: boolean }) => mockDirCreate(opts);
}

function MockFile(this: any, path: string) {
  this.uri = path;
  this.create = (opts?: { overwrite?: boolean }) => mockFileCreate(opts);
  this.write = (content: string) => mockFileWrite(content);
}

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///docs/' },
  Directory: MockDirectory,
  File: MockFile,
}));

const mockIsAvailableAsync = jest.fn(async () => true);
const mockShareAsync = jest.fn(async (_uri: string) => undefined);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (uri: string) => mockShareAsync(uri),
}));

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
    mockMagListener = null;
    recorder = new RawSampleRecorder();
  });

  it('returns a session tagged with the caller-supplied scenario and platform', () => {
    const session = recorder.start('handheld', 'ios');

    expect(session.scenario).toBe('handheld');
    expect(session.platform).toBe('ios');
    expect(session.filePath).toContain(session.sessionId);
    expect(mockDirCreate).toHaveBeenCalledWith({ idempotent: true });
  });

  it('drops samples pushed before start() or after stop()', async () => {
    recorder.pushAccelSample(1, 2, 3);
    expect(mockFileWrite).not.toHaveBeenCalled();

    recorder.start('mounted', 'android');
    await recorder.stop();
    recorder.pushGyroSample(4, 5, 6);

    // Nothing buffered after the session ended — a second stop() has nothing to write.
    await recorder.stop();
    expect(mockFileWrite).toHaveBeenCalledTimes(1);
  });

  it('writes one NDJSON line per pushed sample, tagged by kind', async () => {
    recorder.start('in-pocket', 'ios');
    recorder.pushAccelSample(1, 2, 3);
    recorder.pushGyroSample(4, 5, 6);
    recorder.pushLocationSample(32.05, 34.77, 10, 5);

    await recorder.stop();

    expect(mockFileWrite).toHaveBeenCalledTimes(1);
    const body = mockFileWrite.mock.calls[0][0];
    const lines = body.split('\n').map((l: string) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines.map((l: any) => l.kind)).toEqual(['accel', 'gyro', 'location']);
    expect(lines[0].accel).toEqual({ x: 1, y: 2, z: 3 });
    expect(lines[2].location).toEqual({ lat: 32.05, lng: 34.77, speed: 10, accuracy: 5 });
  });

  it('exports the last completed recording via the share sheet', async () => {
    recorder.start('handheld', 'ios');
    recorder.pushAccelSample(1, 1, 1);
    const session = await recorder.stop();

    const result = await recorder.exportAsync();

    expect(mockShareAsync).toHaveBeenCalledWith(session!.filePath);
    expect(result).toBe(session!.filePath);
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

  // CAR-295 - magnetometer, the one stream the recorder subscribes to itself.

  it('serialises magnetometer samples alongside the pushed streams', async () => {
    recorder.start('mounted', 'android');
    recorder.pushAccelSample(1, 2, 3);
    mockMagListener!({ x: 21.5, y: -8, z: 44.25 });

    await recorder.stop();

    const lines = mockFileWrite.mock.calls[0][0].split('\n').map((l: string) => JSON.parse(l));
    expect(lines.map((l: any) => l.kind)).toEqual(['accel', 'mag']);
    expect(lines[1].mag).toEqual({ x: 21.5, y: -8, z: 44.25 });
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

  it('does not leak a subscription when start() is called twice without a stop()', () => {
    recorder.start('handheld', 'ios');
    recorder.start('on-seat', 'ios');

    expect(mockMagAddListener).toHaveBeenCalledTimes(2);
    expect(mockMagRemove).toHaveBeenCalledTimes(1);
  });
});
