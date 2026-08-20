// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockMakeDirectoryAsync = jest.fn(async () => undefined);
const mockWriteAsStringAsync = jest.fn(async () => undefined);

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: (...args: any[]) => mockMakeDirectoryAsync(...args),
  writeAsStringAsync: (...args: any[]) => mockWriteAsStringAsync(...args),
}));

const mockIsAvailableAsync = jest.fn(async () => true);
const mockShareAsync = jest.fn(async () => undefined);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (...args: any[]) => mockShareAsync(...args),
}));

import { RawSampleRecorder } from '@/lib/driving-sdk/sensors/RawSampleRecorder';

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
  });

  it('drops samples pushed before start() or after stop()', async () => {
    recorder.pushAccelSample(1, 2, 3);
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();

    recorder.start('mounted', 'android');
    await recorder.stop();
    recorder.pushGyroSample(4, 5, 6);

    // Nothing buffered after the session ended — a second stop() has nothing to write.
    await recorder.stop();
    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
  });

  it('writes one NDJSON line per pushed sample, tagged by kind', async () => {
    recorder.start('in-pocket', 'ios');
    recorder.pushAccelSample(1, 2, 3);
    recorder.pushGyroSample(4, 5, 6);
    recorder.pushLocationSample(32.05, 34.77, 10, 5);

    await recorder.stop();

    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    const [, body] = mockWriteAsStringAsync.mock.calls[0];
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

  it('exports null when nothing was ever recorded', async () => {
    const result = await recorder.exportAsync();

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
