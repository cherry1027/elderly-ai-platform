import { AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';
import type { AudioRecording } from '../api/audio-transcripts';

export const MAX_RECORDING_MS = 60_000;
const MAX_AUDIO_BYTES = 25_000_000;

export type RecordingFailureStage = 'foreground' | 'audio-mode' | 'creation' | 'preparation' |
  'file-validation' | 'startup' | 'interrupted' | 'finalization';

/** Fixed stage only: never retain a native exception, URI or permission payload. */
export class RecordingFailure extends Error {
  constructor(readonly stage: RecordingFailureStage, operation: 'start' | 'stop' = 'start') {
    super(operation === 'stop' ? 'Recording could not be prepared.' : 'Recording is unavailable.');
    this.name = 'RecordingFailure';
  }
}

export type RecordingStatus = { durationMs: number; isRecording: boolean; interrupted: boolean };
export type RecordingDriver = {
  requestPermission(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<AudioRecording>;
  getStatus(): RecordingStatus;
  discard(recording: AudioRecording): Promise<void>;
  dispose(): Promise<void>;
};

type NativeRecorder = {
  uri: string | null;
  isRecording: boolean;
  prepareToRecordAsync(): Promise<void>;
  record(options: { forDuration: number }): void;
  stop(): Promise<void>;
  getStatus(): { durationMillis: number; isRecording: boolean; mediaServicesDidReset: boolean };
  addListener?(event: 'recordingStatusUpdate', listener: (status: {
    hasError: boolean; mediaServicesDidReset?: boolean; isFinished: boolean;
  }) => void): { remove(): void };
  release(): void;
};

// The narrow dependency seam keeps microphone and filesystem operations mocked
// in tests. It does not expose paths, recording bytes or native error messages.
export type RecorderDependencies = {
  requestPermission(): Promise<boolean>;
  foreground(): boolean;
  cacheUri: string;
  platform?: 'ios' | 'android';
  createRecorder(): NativeRecorder;
  recordingMode(enabled: boolean): Promise<void>;
  fileInfo(uri: string): { exists: boolean; size: number };
  deleteFile(uri: string): void;
};

type CaptureLease = { owner?: symbol };
const nativeCaptureLease: CaptureLease = {};
const injectedCaptureLeases = new WeakMap<RecorderDependencies, CaptureLease>();
function nativeDependencies(): RecorderDependencies {
  const preset = RecordingPresets.HIGH_QUALITY;
  // AudioModule's constructor takes native, flattened options. The SDK hook
  // performs the same conversion; passing the nested preset directly would
  // omit the AAC/MPEG-4 format on native platforms.
  const options = {
    extension: preset.extension,
    sampleRate: preset.sampleRate,
    numberOfChannels: preset.numberOfChannels,
    bitRate: preset.bitRate,
    directory: 'cache' as const,
    ...(Platform.OS === 'ios' ? preset.ios : preset.android),
  };
  return {
    requestPermission: async () => (await AudioModule.requestRecordingPermissionsAsync()).granted,
    foreground: () => (Platform.OS === 'ios' || Platform.OS === 'android') && AppState.currentState === 'active',
    cacheUri: Paths.cache.uri,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    createRecorder: () => {
      // SDK 57 exports this constructor through typed NativeAudioModule;
      // import/namespace cannot inspect its native-module declaration.
      // eslint-disable-next-line import/namespace
      return new AudioModule.AudioRecorder(options);
    },
    recordingMode: enabled => setAudioModeAsync({
      allowsRecording: enabled,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      allowsBackgroundRecording: false,
      interruptionMode: 'doNotMix',
    }),
    fileInfo: uri => {
      const file = new File(uri);
      return { exists: file.exists, size: file.size };
    },
    deleteFile: uri => {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
  };
}

export function createRecordingId(): string {
  const value = Crypto.randomUUID();
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) {
    throw new Error('Secure recording identity is unavailable.');
  }
  return value;
}

export function createNativeRecorder(injected?: RecorderDependencies): RecordingDriver {
  // Creating a driver does not ask for permission or create a native recorder.
  const dependencies = injected ?? nativeDependencies();
  const lease: CaptureLease = injected
    ? injectedCaptureLeases.get(injected) ?? {}
    : nativeCaptureLease;
  if (injected) injectedCaptureLeases.set(injected, lease);
  const owner = Symbol('foreground-recording');
  const unlock = () => { if (lease.owner === owner) lease.owner = undefined; };
  const owned = new Set<string>();
  let recorder: NativeRecorder | undefined;
  let disposed = false;
  let granted = false;
  let starting: Promise<void> | undefined;
  let stopping: Promise<AudioRecording> | undefined;
  let disposing: Promise<void> | undefined;
  let durationMs = 0;
  let interrupted = false;
  let started = false;
  let subscription: { remove(): void } | undefined;
  const unsubscribe = () => { try { subscription?.remove(); } catch { /* no native details escape */ } finally { subscription = undefined; } };

  function localFilePath(uri: string | null): string | null {
    if (!uri) return null;
    try {
      const path = decodeURIComponent(uri);
      if (!/^file:\/\/\/(?!\/)/.test(path) || /[\0\r\n?#\\]/.test(path) ||
        path.split('/').some(segment => segment === '..' || segment === '.')) return null;
      // iOS may expose the same app container through /var or /private/var.
      return path.replace(/^file:\/\/\/private\/var\//, 'file:///var/');
    } catch { return null; }
  }

  function ownedCacheUri(uri: string | null): uri is string {
    const path = localFilePath(uri);
    const cache = localFilePath(dependencies.cacheUri)?.replace(/\/+$/, '');
    if (!path || !cache || !path.endsWith('.m4a')) return false;
    if (path.startsWith(cache + '/')) return true;
    if (dependencies.platform !== 'ios') return false;
    // SDK 57 Audio uses appContext.fileSystem.cachesDirectory; FileSystem Paths
    // uses config.cacheDirectory, which Expo Go may scope below that directory.
    // Permit only the SDK's exact generated filename in the SAME app's native
    // Library/Caches/ExpoAudio directory, never another project/container/path.
    const boundary = '/Library/Caches';
    const end = cache.lastIndexOf(boundary);
    if (end < 0 || (cache.length > end + boundary.length && cache[end + boundary.length] !== '/')) return false;
    const nativeCache = cache.slice(0, end + boundary.length);
    const prefix = nativeCache + '/ExpoAudio/';
    return path.startsWith(prefix) &&
      /^recording-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.m4a$/i.test(path.slice(prefix.length));
  }

  function remember(value: NativeRecorder): void {
    if (ownedCacheUri(value.uri)) owned.add(value.uri);
  }

  function cleanup(uri: string): void {
    if (!owned.has(uri)) return;
    dependencies.deleteFile(uri);
    owned.delete(uri);
  }

  function status(): RecordingStatus {
    if (!recorder) return { durationMs, isRecording: false, interrupted };
    try {
      const current = recorder.getStatus();
      if (Number.isFinite(current.durationMillis) && current.durationMillis >= 0) {
        durationMs = Math.max(durationMs, Math.min(MAX_RECORDING_MS, current.durationMillis));
      }
      interrupted ||= current.mediaServicesDidReset;
      // A spontaneous early stop is an interruption, not a completed turn.
      // The native 60-second cap is allowed to finish between polling ticks.
      interrupted ||= started && !current.isRecording && durationMs < MAX_RECORDING_MS - 1000;
      return { durationMs, isRecording: current.isRecording, interrupted };
    } catch {
      interrupted = true;
      return { durationMs, isRecording: false, interrupted: true };
    }
  }

  async function release(value: NativeRecorder, remove: boolean): Promise<void> {
    remember(value);
    const uri = value.uri;
    started = false;
    try { await value.stop(); } catch { /* release still stops native capture */ }
    unsubscribe();
    try { value.release(); } finally {
      if (recorder === value) recorder = undefined;
      started = false;
      try { await dependencies.recordingMode(false); } finally {
        unlock();
        if (remove && uri && owned.has(uri)) cleanup(uri);
      }
    }
  }

  async function start(): Promise<void> {
    if (disposed || starting || stopping || recorder) throw new RecordingFailure('startup');
    if (!dependencies.foreground()) throw new RecordingFailure('foreground');
    if (!granted) throw new Error('Microphone permission is required.');
    // Expo's audio mode is global. A previous screen may still be releasing
    // native capture, so never let its cleanup disable a newer recording.
    if (lease.owner) throw new Error('Recording is unavailable.');
    lease.owner = owner;
    const operation = (async () => {
      let stage: RecordingFailureStage = 'audio-mode';
      durationMs = 0;
      interrupted = false;
      started = false;
      try {
        await dependencies.recordingMode(true);
        if (disposed || !dependencies.foreground()) throw new RecordingFailure('foreground');
        stage = 'creation';
        const value = dependencies.createRecorder();
        recorder = value;
        remember(value);
        subscription = value.addListener?.('recordingStatusUpdate', event => {
          if (event.hasError || event.mediaServicesDidReset ||
              (started && event.isFinished && durationMs < MAX_RECORDING_MS - 1000)) interrupted = true;
        });
        stage = 'preparation';
        await value.prepareToRecordAsync();
        remember(value);
        if (disposed || !dependencies.foreground()) throw new RecordingFailure('foreground');
        if (interrupted) throw new RecordingFailure('interrupted');
        if (!ownedCacheUri(value.uri)) throw new RecordingFailure('file-validation');
        stage = 'startup';
        value.record({ forDuration: MAX_RECORDING_MS / 1000 });
        started = true;
        if (interrupted) throw new RecordingFailure('interrupted');
        if (!value.isRecording || !value.getStatus().isRecording) throw new RecordingFailure('startup');
      } catch (error) {
        if (recorder) {
          try { await release(recorder, true); } catch { /* dispose can retry owned-file cleanup */ }
        } else {
          try { await dependencies.recordingMode(false); } catch { /* no native capture exists */ } finally { unlock(); }
        }
        throw error instanceof RecordingFailure ? error : new RecordingFailure(stage);
      }
    })();
    starting = operation;
    try { await operation; } finally { starting = undefined; }
  }

  async function stop(): Promise<AudioRecording> {
    if (stopping) return stopping;
    if (disposed || starting || !recorder) throw new Error('Recording is unavailable.');
    const value = recorder;
    const operation = (async (): Promise<AudioRecording> => {
      let failed = false;
      let stage: RecordingFailureStage = 'file-validation';
      let uri: string | null = null;
      try {
        // iOS resets durationMillis to zero when stop/auto-stop completes.
        // Preserve the maximum sampled duration before stopping.
        status();
        uri = value.uri;
        if (interrupted) throw new RecordingFailure('interrupted', 'stop');
        if (!ownedCacheUri(uri) || !owned.has(uri)) throw new RecordingFailure('file-validation', 'stop');
        started = false;
        stage = 'finalization';
        await value.stop();
        if (disposed || interrupted) throw new RecordingFailure('interrupted', 'stop');
        stage = 'file-validation';
        if (durationMs < 1) throw new RecordingFailure('file-validation', 'stop');
        const info = dependencies.fileInfo(uri);
        if (!info.exists || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size >= MAX_AUDIO_BYTES) {
          throw new Error();
        }
        return { uri, name: 'recording.m4a', type: 'audio/mp4', size: info.size, durationMs };
      } catch (error) {
        failed = true;
        throw error instanceof RecordingFailure ? error : new RecordingFailure(stage, 'stop');
      } finally {
        unsubscribe();
        try { value.release(); } catch {
          failed = true;
          throw new RecordingFailure('finalization', 'stop');
        } finally {
          if (recorder === value) recorder = undefined;
          started = false;
          try { await dependencies.recordingMode(false); } catch { /* released recorder cannot capture */ } finally { unlock(); }
          if (failed && uri && owned.has(uri)) {
            try { cleanup(uri); } catch { /* dispose retries this exact owned file */ }
          }
        }
      }
    })();
    stopping = operation;
    try { return await operation; } finally { stopping = undefined; }
  }

  async function dispose(): Promise<void> {
    if (disposing) return disposing;
    disposed = true;
    disposing = (async () => {
      if (starting) { try { await starting; } catch { /* start cleans up on cancellation */ } }
      if (stopping) { try { await stopping; } catch { /* only cleanup remains */ } }
      if (recorder) { try { await release(recorder, false); } catch { /* continue exact-file cleanup */ } }
      let failed = false;
      for (const uri of owned) {
        try { cleanup(uri); } catch { failed = true; }
      }
      granted = false;
      if (failed) throw new Error('Temporary recording cleanup was unsuccessful.');
    })();
    try { await disposing; } finally { disposing = undefined; }
  }

  return {
    async requestPermission() {
      if (disposed || !dependencies.foreground()) return false;
      let permission: boolean;
      try { permission = await dependencies.requestPermission(); }
      catch { granted = false; return false; }
      if (disposed) { granted = false; return false; }
      if (!dependencies.foreground()) {
        granted = false;
        if (permission) throw new RecordingFailure('foreground');
        return false;
      }
      granted = permission;
      return granted;
    },
    start,
    stop,
    getStatus: status,
    async discard(recording) {
      if (!owned.has(recording.uri)) return;
      try { cleanup(recording.uri); } catch { throw new Error('Temporary recording cleanup was unsuccessful.'); }
    },
    dispose,
  };
}
