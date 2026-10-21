import { AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { AppState, Platform } from 'react-native';
import { createNativeRecorder, createRecordingId, MAX_RECORDING_MS, RecordingFailure, type RecorderDependencies } from '../src/audio/native-recorder';
import type { AudioRecording } from '../src/api/audio-transcripts';

jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn(), AudioRecorder: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {
    extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000,
    ios: { outputFormat: 'aac ', audioQuality: 127 },
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  } },
  setAudioModeAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///synthetic-cache/' } }, File: jest.fn(),
}));

const uri = 'file:///synthetic-cache/ExpoAudio/recording-synthetic.m4a';
const otherUri = 'file:///synthetic-cache/ExpoAudio/recording-other.m4a';
const uuid = '35b53962-6167-4d64-a388-54f2d5bd83da';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const current = { durationMillis: 0, isRecording: false, mediaServicesDidReset: false };
  type NativeEvent = { hasError: boolean; mediaServicesDidReset?: boolean; isFinished: boolean };
  let listener: ((status: NativeEvent) => void) | undefined;
  const removeListener = jest.fn(() => { listener = undefined; });
  const native = {
    uri: uri as string | null,
    get isRecording() { return current.isRecording; },
    prepareToRecordAsync: jest.fn(async (): Promise<void> => undefined),
    record: jest.fn(() => { current.isRecording = true; }),
    stop: jest.fn(async (): Promise<void> => { current.durationMillis = 0; current.isRecording = false; }),
    getStatus: jest.fn(() => ({ ...current })),
    addListener: jest.fn((_event: 'recordingStatusUpdate', next: (event: NativeEvent) => void) => {
      listener = next;
      return { remove: removeListener };
    }),
    release: jest.fn(),
  };
  const dependencies = {
    requestPermission: jest.fn(async (): Promise<boolean> => true),
    foreground: jest.fn((): boolean => true),
    cacheUri: 'file:///synthetic-cache/',
    createRecorder: jest.fn(() => native),
    recordingMode: jest.fn(async (_enabled: boolean): Promise<void> => undefined),
    fileInfo: jest.fn((_uri: string): { exists: boolean; size: number } => ({ exists: true, size: 12000 })),
    deleteFile: jest.fn((_uri: string) => undefined),
  } satisfies RecorderDependencies;
  const driver = createNativeRecorder(dependencies);
  async function start() {
    await driver.requestPermission();
    await driver.start();
    current.durationMillis = 5000;
  }
  return { driver, native, dependencies, current, start, removeListener, emit: (event: NativeEvent) => listener?.(event) };
}

const originalAppState = AppState.currentState;
beforeEach(() => { jest.mocked(Crypto.randomUUID).mockReturnValue(uuid); });
afterEach(() => { AppState.currentState = originalAppState; jest.restoreAllMocks(); });

test('creation does not request permission, create files or configure audio', () => {
  const { dependencies } = fixture();
  expect(dependencies.requestPermission).not.toHaveBeenCalled();
  expect(dependencies.createRecorder).not.toHaveBeenCalled();
  expect(dependencies.recordingMode).not.toHaveBeenCalled();
  expect(dependencies.deleteFile).not.toHaveBeenCalled();
});

test('permission is requested only through the explicit method', async () => {
  const f = fixture();
  expect(await f.driver.requestPermission()).toBe(true);
  expect(f.dependencies.requestPermission).toHaveBeenCalledTimes(1);
  expect(f.dependencies.createRecorder).not.toHaveBeenCalled();
});

test('denied permission prevents native recording', async () => {
  const f = fixture();
  f.dependencies.requestPermission.mockResolvedValue(false);
  expect(await f.driver.requestPermission()).toBe(false);
  await expect(f.driver.start()).rejects.toThrow('Microphone permission is required.');
  expect(f.dependencies.createRecorder).not.toHaveBeenCalled();
});

test('permission failures are sanitized and do not start capture', async () => {
  const f = fixture();
  f.dependencies.requestPermission.mockRejectedValue(new Error('sensitive-native-detail'));
  expect(await f.driver.requestPermission()).toBe(false);
  await expect(f.driver.start()).rejects.toThrow('Microphone permission is required.');
});

test('start cannot implicitly request permission', async () => {
  const f = fixture();
  await expect(f.driver.start()).rejects.toThrow('Microphone permission is required.');
  expect(f.dependencies.requestPermission).not.toHaveBeenCalled();
});

test('background app cannot request permission or start recording', async () => {
  const f = fixture();
  f.dependencies.foreground.mockReturnValue(false);
  expect(await f.driver.requestPermission()).toBe(false);
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.dependencies.requestPermission).not.toHaveBeenCalled();
  expect(f.dependencies.recordingMode).not.toHaveBeenCalled();
});

test('native duration cap is configured and existing permission is reused', async () => {
  const f = fixture();
  await f.start();
  expect(f.native.record).toHaveBeenCalledWith({ forDuration: 60 });
  expect(MAX_RECORDING_MS).toBe(60_000);
  expect(f.dependencies.requestPermission).toHaveBeenCalledTimes(1);
  expect(f.dependencies.recordingMode).toHaveBeenCalledWith(true);
});

test('stopping preserves duration before iOS resets native status to zero', async () => {
  const f = fixture();
  await f.start();
  const clip = await f.driver.stop();
  expect(clip).toEqual({ uri, name: 'recording.m4a', type: 'audio/mp4', size: 12000, durationMs: 5000 });
  expect(f.current.durationMillis).toBe(0);
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.recordingMode).toHaveBeenLastCalledWith(false);
  expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
});

test('native auto-stop retains the maximum sampled duration', async () => {
  const f = fixture();
  await f.start();
  f.current.durationMillis = 59_800;
  expect(f.driver.getStatus().durationMs).toBe(59_800);
  f.current.durationMillis = 0;
  f.current.isRecording = false;
  expect(f.driver.getStatus()).toEqual({ durationMs: 59_800, isRecording: false, interrupted: false });
  expect((await f.driver.stop()).durationMs).toBe(59_800);
});

test('unexpected early stop is rejected as an interrupted partial clip', async () => {
  const f = fixture();
  await f.start();
  f.driver.getStatus();
  f.current.durationMillis = 0;
  f.current.isRecording = false;
  expect(f.driver.getStatus().interrupted).toBe(true);
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('media-service resets cannot become ready recordings', async () => {
  const f = fixture();
  await f.start();
  f.current.mediaServicesDidReset = true;
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('native status exceptions are sanitized and treated as interruptions', async () => {
  const f = fixture();
  await f.start();
  f.native.getStatus.mockImplementation(() => { throw new Error('sensitive-native-detail'); });
  expect(f.driver.getStatus()).toEqual({ durationMs: 0, isRecording: false, interrupted: true });
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
});

test.each([0, -1, NaN, Infinity, 1.5, 25_000_000, 25_000_001])('rejects invalid audio size %s', async size => {
  const f = fixture();
  await f.start();
  f.dependencies.fileInfo.mockReturnValue({ exists: true, size });
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('missing cache file cannot become a ready clip', async () => {
  const f = fixture();
  await f.start();
  f.dependencies.fileInfo.mockReturnValue({ exists: false, size: 12000 });
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
});

test('zero-duration captures cannot become ready clips', async () => {
  const f = fixture();
  await f.start();
  f.current.durationMillis = 0;
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
});

test.each([
  'file:///unrelated-private-directory/recording.m4a',
  'file:///synthetic-cache-neighbor/recording.m4a',
  'file:///synthetic-cache/../private/recording.m4a',
  'file:///synthetic-cache/%2e%2e/private/recording.m4a',
  'file:///synthetic-cache/recording.mp3',
  'https://example.invalid/recording.m4a',
  'file:///synthetic-cache/recording.m4a?query',
  'file:///synthetic-cache/recording.m4a#fragment',
  'file:///synthetic-cache/%ZZrecording.m4a',
])('rejects unsafe recorder path without deleting it: %s', async unsafe => {
  const f = fixture();
  f.native.uri = unsafe;
  await f.driver.requestPermission();
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
  expect(f.native.record).not.toHaveBeenCalled();
});

test('discard only deletes the exact owned recording and is idempotent', async () => {
  const f = fixture();
  await f.start();
  const clip = await f.driver.stop();
  await f.driver.discard({ ...clip, uri: otherUri });
  expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
  await f.driver.discard(clip);
  await f.driver.discard(clip);
  expect(f.dependencies.deleteFile).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('dispose stops and releases active capture and deletes only its clip', async () => {
  const f = fixture();
  await f.start();
  await f.driver.dispose();
  await f.driver.dispose();
  expect(f.native.stop).toHaveBeenCalledTimes(1);
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledTimes(1);
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
});

test('dispose removes a stopped clip retained for upload retry', async () => {
  const f = fixture();
  await f.start();
  await f.driver.stop();
  await f.driver.dispose();
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('late permission after disposal cannot authorize a recording', async () => {
  const f = fixture();
  const pending = deferred<boolean>();
  f.dependencies.requestPermission.mockReturnValue(pending.promise);
  const permission = f.driver.requestPermission();
  await f.driver.dispose();
  pending.resolve(true);
  expect(await permission).toBe(false);
  expect(f.dependencies.createRecorder).not.toHaveBeenCalled();
});

test('disposal during audio setup cannot create a native recorder', async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.dependencies.recordingMode.mockImplementationOnce(() => pending.promise);
  await f.driver.requestPermission();
  const start = f.driver.start();
  const checked = expect(start).rejects.toThrow('Recording is unavailable.');
  const disposed = f.driver.dispose();
  pending.resolve();
  await checked;
  await disposed;
  expect(f.dependencies.createRecorder).not.toHaveBeenCalled();
});

test('disposal during native preparation never activates the microphone', async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.native.prepareToRecordAsync.mockReturnValue(pending.promise);
  await f.driver.requestPermission();
  const start = f.driver.start();
  const checked = expect(start).rejects.toThrow('Recording is unavailable.');
  await Promise.resolve();
  const disposed = f.driver.dispose();
  pending.resolve();
  await checked;
  await disposed;
  expect(f.native.record).not.toHaveBeenCalled();
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('background transition during native preparation prevents recording', async () => {
  const f = fixture();
  f.native.prepareToRecordAsync.mockImplementation(async () => { f.dependencies.foreground.mockReturnValue(false); });
  await f.driver.requestPermission();
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.native.record).not.toHaveBeenCalled();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});

test('failed native preparation releases capture and does not expose raw errors', async () => {
  const f = fixture();
  f.native.prepareToRecordAsync.mockRejectedValue(new Error('sensitive-native-detail'));
  await f.driver.requestPermission();
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('failed stop still releases capture before deleting its file', async () => {
  const f = fixture();
  await f.start();
  f.native.stop.mockRejectedValue(new Error('sensitive-native-detail'));
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
  expect(f.native.release.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.deleteFile.mock.invocationCallOrder[0]);
});

test('cleanup failures remain retryable without widening ownership', async () => {
  const f = fixture();
  await f.start();
  const clip = await f.driver.stop();
  f.dependencies.deleteFile.mockImplementationOnce(() => { throw new Error('sensitive-native-detail'); });
  await expect(f.driver.discard(clip)).rejects.toThrow('Temporary recording cleanup was unsuccessful.');
  await f.driver.dispose();
  expect(f.dependencies.deleteFile.mock.calls).toEqual([[uri], [uri]]);
});

test('a duplicate start cannot create another recorder', async () => {
  const f = fixture();
  await f.start();
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.dependencies.createRecorder).toHaveBeenCalledTimes(1);
  await f.driver.dispose();
});

test('concurrent stop calls share one native operation', async () => {
  const f = fixture();
  await f.start();
  const pending = deferred<void>();
  f.native.stop.mockReturnValue(pending.promise);
  const first = f.driver.stop();
  const second = f.driver.stop();
  pending.resolve();
  expect(await first).toEqual(await second);
  expect(f.native.stop).toHaveBeenCalledTimes(1);
  expect(f.native.release).toHaveBeenCalledTimes(1);
});

test('secure UUID comes from Expo Crypto without a fallback', () => {
  expect(createRecordingId()).toBe(uuid);
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test.each(['not-a-uuid', '00000000-0000-0000-0000-000000000000', '35b53962-6167-1d64-a388-54f2d5bd83da'])('invalid native UUID fails closed: %s', invalid => {
  jest.mocked(Crypto.randomUUID).mockReturnValue(invalid as ReturnType<typeof Crypto.randomUUID>);
  expect(() => createRecordingId()).toThrow('Secure recording identity is unavailable.');
});

test('default native adapter selects SDK high-quality AAC/M4A and foreground mode', async () => {
  const f = fixture();
  AppState.currentState = 'active';
  jest.mocked(AudioModule.requestRecordingPermissionsAsync).mockResolvedValue({ granted: true } as never);
  // SDK 57 NativeAudioModule exposes this native constructor.
  // eslint-disable-next-line import/namespace
  jest.mocked(AudioModule.AudioRecorder).mockImplementation(() => f.native as never);
  jest.mocked(setAudioModeAsync).mockResolvedValue(undefined);
  jest.mocked(File).mockImplementation(() => ({ exists: true, size: 12000, delete: jest.fn() }) as unknown as File);
  const driver = createNativeRecorder();
  await driver.requestPermission();
  await driver.start();
  f.current.durationMillis = 5000;
  const clip = await driver.stop();
  expect(clip.type).toBe('audio/mp4');
  // eslint-disable-next-line import/namespace -- verified SDK 57 native constructor
  expect(AudioModule.AudioRecorder).toHaveBeenCalledWith(expect.objectContaining({
    extension: '.m4a', directory: 'cache', sampleRate: 44100, numberOfChannels: 2,
    ...(Platform.OS === 'ios' ? RecordingPresets.HIGH_QUALITY.ios : RecordingPresets.HIGH_QUALITY.android),
  }));
  expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true, shouldPlayInBackground: false }));
  await driver.dispose();
  jest.restoreAllMocks();
});

test('recording metadata never contains bytes or persistent storage access', async () => {
  const f = fixture();
  await f.start();
  const clip: AudioRecording = await f.driver.stop();
  expect(Object.keys(clip).sort()).toEqual(['durationMs', 'name', 'size', 'type', 'uri']);
});

test('a second driver cannot start until the previous audio mode cleanup finishes', async () => {
  const f = fixture();
  const next = fixture();
  await f.start();
  f.dependencies.createRecorder.mockReturnValue(next.native);
  const anotherDriver = createNativeRecorder(f.dependencies);
  await anotherDriver.requestPermission();
  const pendingMode = deferred<void>();
  f.dependencies.recordingMode.mockImplementation(enabled => enabled ? Promise.resolve() : pendingMode.promise);
  const cleanup = f.driver.dispose();
  await Promise.resolve();
  await Promise.resolve();
  await expect(anotherDriver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.dependencies.createRecorder).toHaveBeenCalledTimes(1);
  pendingMode.resolve();
  await cleanup;
  await anotherDriver.start();
  expect(next.native.record).toHaveBeenCalledTimes(1);
  await anotherDriver.dispose();
});

test('a blocked second driver cannot disable the first driver audio mode', async () => {
  const f = fixture();
  await f.start();
  const anotherDriver = createNativeRecorder(f.dependencies);
  await anotherDriver.requestPermission();
  await expect(anotherDriver.start()).rejects.toThrow('Recording is unavailable.');
  await anotherDriver.dispose();
  expect(f.dependencies.recordingMode.mock.calls).toEqual([[true]]);
  expect(f.native.stop).not.toHaveBeenCalled();
  await f.driver.dispose();
});
test('native media reset events remain latched even if SDK status clears the flag', async () => {
  const f = fixture();
  await f.start();
  f.current.durationMillis = 59_900;
  f.driver.getStatus();
  f.emit({ hasError: false, mediaServicesDidReset: true, isFinished: true });
  f.current.mediaServicesDidReset = false;
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('native error events cannot become a ready clip and subscriptions are released', async () => {
  const f = fixture();
  await f.start();
  f.emit({ hasError: true, isFinished: true });
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.removeListener).toHaveBeenCalledTimes(1);
  expect(f.removeListener.mock.invocationCallOrder[0]).toBeLessThan(f.native.release.mock.invocationCallOrder[0]);
});

test('native reset during preparation prevents capture entirely', async () => {
  const f = fixture();
  f.native.prepareToRecordAsync.mockImplementation(async () => {
    f.emit({ hasError: false, mediaServicesDidReset: true, isFinished: true });
  });
  await f.driver.requestPermission();
  await expect(f.driver.start()).rejects.toThrow('Recording is unavailable.');
  expect(f.native.record).not.toHaveBeenCalled();
  expect(f.removeListener).toHaveBeenCalledTimes(1);
});

test('native release failure cannot expose raw details or leave a reusable clip', async () => {
  const f = fixture();
  await f.start();
  f.native.release.mockImplementation(() => { throw new Error('sensitive-native-detail'); });
  await expect(f.driver.stop()).rejects.toThrow('Recording could not be prepared.');
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
  expect(f.dependencies.recordingMode).toHaveBeenLastCalledWith(false);
});
test('iOS Expo Go accepts its native SDK cache output when FileSystem cache is project-scoped', async () => {
  const f = fixture();
  const container = 'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/';
  const nativeUri = container + 'ExpoAudio/recording-' + uuid + '.m4a';
  f.native.uri = nativeUri;
  const driver = createNativeRecorder({ ...f.dependencies,
    platform: 'ios', cacheUri: container + 'ExponentExperienceData/synthetic-project/' });
  await driver.requestPermission();
  await driver.start();
  expect(f.native.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  expect(f.native.record).toHaveBeenCalledWith({ forDuration: 60 });
  f.current.durationMillis = 5000;
  const clip = await driver.stop();
  expect(clip.uri).toBe(nativeUri);
  await driver.discard({ ...clip, uri: container + 'ExpoAudio/recording-other.m4a' });
  expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
  await driver.discard(clip);
  expect(f.dependencies.deleteFile).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(nativeUri);
});

test.each([
  ['file:///private/var/mobile/', 'file:///var/mobile/'],
  ['file:///var/mobile/', 'file:///private/var/mobile/'],
])('iOS cache aliases compare safely: %s and %s', async (nativePrefix, cachePrefix) => {
  const f = fixture();
  const suffix = 'Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/';
  f.native.uri = nativePrefix + suffix + 'ExpoAudio/recording-' + uuid + '.m4a';
  const driver = createNativeRecorder({ ...f.dependencies, platform: 'ios',
    cacheUri: cachePrefix + suffix + 'ExponentExperienceData/fictional/' });
  await driver.requestPermission(); await driver.start();
  expect(f.native.record).toHaveBeenCalledTimes(1);
  await driver.dispose();
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(f.native.uri);
});

test.each([
  'file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Library/Caches/ExpoAudio/recording-' + uuid + '.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Documents/ExpoAudio/recording-' + uuid + '.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExponentExperienceData/another-project/recording-' + uuid + '.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/Other/recording-' + uuid + '.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExpoAudio/untrusted.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExpoAudio/recording-not-a-uuid.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExpoAudio/%2e%2e/recording-' + uuid + '.m4a',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExpoAudio/recording-' + uuid + '.m4a?secret',
  'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExpoAudio/recording-%00' + uuid + '.m4a',
])('iOS native-cache compatibility never permits an unsafe or unrelated path: %s', async unsafe => {
  const f = fixture(); f.native.uri = unsafe;
  const driver = createNativeRecorder({ ...f.dependencies, platform: 'ios',
    cacheUri: 'file:///var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Caches/ExponentExperienceData/current-project/' });
  await driver.requestPermission();
  await expect(driver.start()).rejects.toMatchObject({ stage: 'file-validation' });
  expect(f.native.record).not.toHaveBeenCalled(); expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
  await driver.dispose();
  expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
});

test('the iOS native-cache exception is not applied to Android', async () => {
  const f = fixture();
  const root = 'file:///synthetic/Library/Caches/';
  f.native.uri = root + 'ExpoAudio/recording-' + uuid + '.m4a';
  const driver = createNativeRecorder({ ...f.dependencies, platform: 'android',
    cacheUri: root + 'ExponentExperienceData/current-project/' });
  await driver.requestPermission();
  await expect(driver.start()).rejects.toMatchObject({ stage: 'file-validation' });
  expect(f.native.record).not.toHaveBeenCalled(); expect(f.dependencies.deleteFile).not.toHaveBeenCalled();
});

test('a first permission grant while inactive cannot prepare or record, and a subsequent deliberate attempt can', async () => {
  const f = fixture(); const permission = deferred<boolean>();
  f.dependencies.requestPermission.mockReturnValueOnce(permission.promise);
  const first = f.driver.requestPermission();
  f.dependencies.foreground.mockReturnValue(false);
  permission.resolve(true);
  await expect(first).rejects.toMatchObject({ stage: 'foreground' });
  expect(f.dependencies.recordingMode).not.toHaveBeenCalled(); expect(f.native.record).not.toHaveBeenCalled();
  f.dependencies.foreground.mockReturnValue(true);
  await f.driver.requestPermission(); await f.driver.start();
  expect(f.native.record).toHaveBeenCalledTimes(1);
  await f.driver.dispose();
});

test('SDK initialization waits for permission, then prepares without replacing options before native recording', async () => {
  const f = fixture(); const permission = deferred<boolean>(); const preparation = deferred<void>();
  f.dependencies.requestPermission.mockReturnValueOnce(permission.promise);
  f.native.prepareToRecordAsync.mockReturnValueOnce(preparation.promise);
  const allowed = f.driver.requestPermission();
  expect(f.dependencies.createRecorder).not.toHaveBeenCalled();
  permission.resolve(true); expect(await allowed).toBe(true);
  const start = f.driver.start();
  await Promise.resolve();
  expect(f.native.prepareToRecordAsync).toHaveBeenCalledWith();
  expect(f.native.record).not.toHaveBeenCalled();
  preparation.resolve(); await start;
  expect(f.dependencies.recordingMode.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.createRecorder.mock.invocationCallOrder[0]);
  expect(f.native.prepareToRecordAsync.mock.invocationCallOrder[0]).toBeLessThan(f.native.record.mock.invocationCallOrder[0]);
  expect(f.driver.getStatus().isRecording).toBe(true);
  await f.driver.dispose();
});

test.each(['audio-mode', 'creation', 'preparation', 'startup'] as const)('sanitizes and distinguishes %s startup failure', async stage => {
  const f = fixture(); const unsafe = new Error('private-native-detail file:///private/audio/clip.m4a');
  if (stage === 'audio-mode') f.dependencies.recordingMode.mockRejectedValueOnce(unsafe);
  if (stage === 'creation') f.dependencies.createRecorder.mockImplementationOnce(() => { throw unsafe; });
  if (stage === 'preparation') f.native.prepareToRecordAsync.mockRejectedValueOnce(unsafe);
  if (stage === 'startup') f.native.record.mockImplementationOnce(() => { throw unsafe; });
  await f.driver.requestPermission();
  const error = await f.driver.start().catch(failure => failure);
  expect(error).toBeInstanceOf(RecordingFailure); expect(error.stage).toBe(stage);
  expect(error.message).not.toMatch(/private-native-detail|file:/);
  expect(Object.keys(error).sort()).toEqual(['name', 'stage']);
  if (stage !== 'startup') expect(f.native.record).not.toHaveBeenCalled();
  await f.driver.dispose();
});

test('native record returning without capture is a startup failure, never a ready recording', async () => {
  const f = fixture();
  f.native.record.mockImplementationOnce(() => {});
  await f.driver.requestPermission();
  await expect(f.driver.start()).rejects.toMatchObject({ stage: 'startup' });
  expect(f.native.release).toHaveBeenCalledTimes(1);
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});

test('a stopped invalid file is a file-validation failure and cannot be uploaded', async () => {
  const f = fixture(); await f.start();
  f.dependencies.fileInfo.mockReturnValueOnce({ exists: false, size: 0 });
  await expect(f.driver.stop()).rejects.toMatchObject({ stage: 'file-validation' });
  expect(f.dependencies.deleteFile).toHaveBeenCalledWith(uri);
});
