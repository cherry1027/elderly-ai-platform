/** Real, foreground-only browser capture for the approved HTTPS browser app. */
import { randomUUID } from 'expo-crypto';
import { readWebStaging } from '../web-staging';
import type { AudioRecording } from '../api/audio-transcripts';
import type { RecordingDriver, RecordingFailureStage } from './native-recorder';
import { clearBrowserRecordings, discardBrowserRecording, saveBrowserRecording } from './browser-recordings';
export type { RecordingDriver, RecordingStatus, RecordingFailureStage, RecorderDependencies } from './native-recorder';
export const MAX_RECORDING_MS = 60_000;
const MAX_BYTES = 25_000_000;
export class RecordingFailure extends Error {
  constructor(readonly stage: RecordingFailureStage, operation: 'start' | 'stop' = 'start') {
    super(operation === 'stop' ? 'Recording could not be prepared.' : 'Microphone recording is unavailable.');
    this.name = 'RecordingFailure';
  }
}
export function createRecordingId(): string {
  const value = randomUUID();
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw new RecordingFailure('creation');
  return value;
}
let captureOwner: object | null = null;

export function createNativeRecorder(): RecordingDriver {
  const owner = {};
  let disposed = false, permission = false, interrupted = false, started = 0, duration = 0;
  let stream: MediaStream | null = null, recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chunks: Blob[] = [], total = 0, pending: Promise<AudioRecording> | null = null;
  let requesting: Promise<boolean> | null = null;
  let resolve: ((value: AudioRecording) => void) | null = null, reject: ((error: Error) => void) | null = null;
  const foreground = () => readWebStaging() !== null && typeof document !== 'undefined' && document.visibilityState !== 'hidden';
  const release = () => {
    if (timer) clearTimeout(timer); timer = null;
    if (stream) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    stream = null; permission = false;
    if (captureOwner === owner) captureOwner = null;
  };
  const fail = () => {
    interrupted = true; chunks = []; total = 0;
    reject?.(new RecordingFailure('interrupted', 'stop')); resolve = reject = null;
    const previous = recorder; recorder = null;
    if (previous) { previous.onstop = null; previous.ondataavailable = null; previous.onerror = null; }
    try { if (previous?.state !== 'inactive') previous?.stop(); } catch { /* cleanup always continues */ }
    release();
  };
  const currentDuration = () => started ? Math.min(MAX_RECORDING_MS, Math.max(1, Date.now() - started)) : duration;
  const finish = () => {
    duration = currentDuration(); started = 0;
    try {
      if (disposed || interrupted || !foreground() || total < 1 || total > MAX_BYTES) throw new RecordingFailure('finalization', 'stop');
      const type = recorder?.mimeType.split(';')[0] || chunks[0]?.type.split(';')[0];
      const saved = saveBrowserRecording(new Blob(chunks, { type }), owner, duration);
      resolve?.(saved);
    } catch { reject?.(new RecordingFailure('finalization', 'stop')); }
    finally { chunks = []; total = 0; resolve = reject = null; release(); }
  };
  const background = () => { if (!foreground()) { fail(); clearBrowserRecordings(owner); } };
  const pageHide = () => { fail(); clearBrowserRecordings(owner); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);
  return {
    async requestPermission() {
      if (disposed || !foreground() || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' ||
          (captureOwner && captureOwner !== owner)) { release(); return false; }
      if (stream && permission) return true;
      if (requesting) return requesting;
      captureOwner = owner;
      requesting = (async () => {
        try {
          const granted = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
          if (disposed || !foreground() || captureOwner !== owner) { for (const track of granted.getTracks()) track.stop(); release(); return false; }
          stream = granted; permission = true;
          for (const track of stream.getTracks()) track.onended = fail;
          return true;
        } catch { release(); return false; }
        finally { requesting = null; }
      })();
      return requesting;
    },
    async start() {
      if (disposed || !foreground() || !permission || !stream || captureOwner !== owner || recorder?.state === 'recording') throw new RecordingFailure('startup');
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
      if (!type) { release(); throw new RecordingFailure('creation'); }
      interrupted = false; duration = 0; started = 0; chunks = []; total = 0;
      try {
        const instance = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 64_000 });
        recorder = instance;
        pending = new Promise<AudioRecording>((ok, no) => { resolve = ok; reject = no; });
        void pending.catch(() => {});
        recorder.ondataavailable = event => {
          if (recorder !== instance || disposed || interrupted || !event.data.size) return;
          total += event.data.size;
          if (total > MAX_BYTES) fail(); else chunks.push(event.data);
        };
        recorder.onerror = () => { if (recorder === instance) fail(); };
        recorder.onstop = () => { if (recorder === instance) finish(); };
        recorder.start(250); started = Date.now();
        timer = setTimeout(() => { if (recorder?.state === 'recording') { duration = MAX_RECORDING_MS; recorder.stop(); } }, MAX_RECORDING_MS);
      } catch { fail(); throw new RecordingFailure('startup'); }
    },
    async stop() {
      if (disposed || interrupted || !pending || !recorder || !foreground()) throw new RecordingFailure('interrupted', 'stop');
      if (recorder.state === 'recording') { duration = currentDuration(); recorder.stop(); }
      return pending;
    },
    getStatus() {
      return { durationMs: currentDuration(), isRecording: recorder?.state === 'recording', interrupted };
    },
    async discard(recording) { discardBrowserRecording(recording, owner); },
    async dispose() {
      if (disposed) return;
      disposed = true; fail(); clearBrowserRecordings(owner);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
      recorder = null; pending = null;
    },
  };
}
