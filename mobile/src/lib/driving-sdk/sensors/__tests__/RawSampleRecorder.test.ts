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

describe('RawSampleRecorder', () => {
  let recorder: RawSampleRecorder;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
