/** The browser player keeps one foreground-only media element per workspace. */
import type { RealPlayback, StreamingPlayback } from './native-playback';
import { SPEECH_CHUNK_BYTES, SPEECH_SAMPLE_RATE, speechWav } from './voice-pcm';
export type { RealPlayback, PlaybackDependencies, StreamingPlayback } from './native-playback';
export class RealPlaybackError extends Error {
  constructor() { super('The spoken reply could not be played safely.'); this.name = 'RealPlaybackError'; }
}

let audioOwner: object | null = null;

function silentPrimer(): Blob {
  // This silent local clip primes the replay/fallback element in WebKit.
  return new Blob([speechWav([], SPEECH_SAMPLE_RATE / 10).buffer], { type: 'audio/wav' });
}

function enterPlaybackAudioSession(): () => void {
  // Safari can retain a microphone/ambient output route, particularly in
  // silent mode. Request playback only once the microphone has been released.
  if (typeof navigator !== 'undefined') {
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') {
        const previous = session.type;
        session.type = 'playback';
        return () => {
          try { if (session.type === 'playback') session.type = previous; } catch { /* optional API */ }
        };
      }
    } catch { /* optional API */ }
  }
  return () => {};
}

export function createRealPlayback(): RealPlayback {
  const owner = {};
  let closed = false, epoch = 0;
  let element: HTMLAudioElement | null = null, url: string | null = null;
  let cancelStart: (() => void) | null = null, restoreSession: (() => void) | null = null;
  let context: AudioContext | null = null;
  let streaming: StreamingPlayback | null = null;
  const foreground = () => typeof document !== 'undefined' && document.visibilityState !== 'hidden';
  const detach = () => {
    cancelStart?.(); cancelStart = null;
    if (element) {
      element.onended = null;
      element.onerror = null;
      element.pause();
    }
    restoreSession?.(); restoreSession = null;
  };
  const clearSource = () => {
    detach();
    if (element && url) {
      element.removeAttribute('src');
      element.load();
    }
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (audioOwner === owner) audioOwner = null;
  };
  const player = () => {
    if (audioOwner && audioOwner !== owner) throw new RealPlaybackError();
    element ??= new Audio();
    audioOwner = owner;
    return element;
  };
  const assignSource = (media: HTMLAudioElement, blob: Blob) => {
    const previous = url;
    url = URL.createObjectURL(blob);
    try { media.src = url; }
    finally { if (previous) URL.revokeObjectURL(previous); }
  };
  const stop = async () => { epoch++; streaming?.cancel(); clearSource(); };
  const background = () => { if (!foreground()) void stop(); };
  const pageHide = () => { void stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);

  return {
    prepare() {
      if (closed || !foreground() || typeof Audio === 'undefined' || (audioOwner && audioOwner !== owner)) return;
      streaming?.cancel();
      const version = ++epoch;
      try {
        detach();
        const media = player();
        assignSource(media, silentPrimer());
        // WebKit grants gesture permission to this element. Keep the same
        // element for the actual reply once the network request has finished.
        void media.play().catch(() => { if (version === epoch) clearSource(); });
      } catch { clearSource(); }
    },
    prepareStream() {
      if (closed || !foreground() || typeof window === 'undefined' || (audioOwner && audioOwner !== owner)) return;
      try {
        const AudioEngine = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!context && AudioEngine) context = new AudioEngine();
        if (context && context.state !== 'running') void context.resume().catch(() => {});
      } catch { /* Use the verified WAV fallback if Web Audio is unavailable. */ }
    },
    openStream(onFirstSound, onFinish) {
      const engine = context;
      if (closed || streaming || !foreground() || !engine || engine.state !== 'running' ||
        (audioOwner && audioOwner !== owner)) return;
      epoch++;
      clearSource();
      audioOwner = owner;
      restoreSession = enterPlaybackAudioSession();
      const nodes = new Map<AudioBufferSourceNode, AudioBuffer>();
      let nextAt = 0, ended = false, heardSample = false;
      let firstSoundTimer: ReturnType<typeof setTimeout> | undefined;
      function close() {
        if (streaming !== stream) return;
        clearTimeout(firstSoundTimer);
        for (const [source, buffer] of nodes) {
          source.onended = null;
          try { source.stop(); } catch { /* Already ended. */ }
          source.disconnect();
          buffer.getChannelData(0).fill(0);
        }
        nodes.clear();
        streaming = null;
        clearSource();
        onFinish();
      }
      const stream: StreamingPlayback = {
        push(pcm) {
          if (ended || streaming !== stream || !foreground() || engine.state !== 'running' ||
              !pcm.length || pcm.length % 2 || pcm.length > SPEECH_CHUNK_BYTES) return false;
          try {
            const buffer = engine.createBuffer(1, pcm.length / 2, SPEECH_SAMPLE_RATE);
            const samples = buffer.getChannelData(0);
            const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
            let firstSound = -1;
            for (let index = 0; index < samples.length; index++) {
              const sample = view.getInt16(index * 2, true);
              samples[index] = sample / 32768;
              if (!heardSample && firstSound === -1 && Math.abs(sample) > 64) firstSound = index;
            }
            const source = engine.createBufferSource();
            nodes.set(source, buffer);
            source.buffer = buffer;
            source.connect(engine.destination);
            const now = engine.currentTime;
            const at = Math.max(now + 0.05, nextAt);
            nextAt = at + buffer.duration;
            source.onended = () => {
              source.disconnect();
              samples.fill(0);
              nodes.delete(source);
              if (ended && nodes.size === 0) close();
            };
            source.start(at);
            if (firstSound !== -1) {
              heardSample = true;
              const delay = 1000 * (at - now + firstSound / SPEECH_SAMPLE_RATE + (engine.outputLatency || engine.baseLatency || 0));
              const audibleAt = performance.now() + delay;
              firstSoundTimer = setTimeout(() => {
                if (streaming === stream && foreground() && engine.state === 'running') onFirstSound(audibleAt);
              }, delay);
            }
            return true;
          } catch {
            close();
            return false;
          }
        },
        finish() {
          ended = true;
          if (!nodes.size) close();
          return heardSample;
        },
        cancel: close,
      };
      streaming = stream;
      return stream;
    },
    async play(bytes, onFinish, onError) {
      if (closed || !foreground() || typeof Audio === 'undefined' || !(bytes instanceof Uint8Array) ||
          bytes.length < 44 || bytes.length > 10_000_000 ||
          String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
          String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') throw new RealPlaybackError();
      streaming?.cancel();
      const version = ++epoch, copy = Uint8Array.from(bytes);
      const current = () => !closed && version === epoch && foreground();
      let started = false;
      try {
        detach();
        const media = player();
        assignSource(media, new Blob([copy.buffer], { type: 'audio/wav' }));
        restoreSession = enterPlaybackAudioSession();
        const terminal = (failed: boolean) => {
          if (!current()) return;
          epoch++;
          clearSource();
          if (started) {
            if (failed) onError?.();
            else onFinish();
          }
        };
        media.onended = () => terminal(false);
        media.onerror = () => terminal(true);
        // Start synchronously when the caller already owns verified RAM bytes
        // and is still inside the replay tap. The primed element covers fetches.
        await new Promise<void>((resolve, reject) => {
          cancelStart = () => reject(new RealPlaybackError());
          Promise.resolve(media.play()).then(resolve, reject);
        });
        if (!current()) throw new RealPlaybackError();
        cancelStart = null;
        started = true;
      } catch {
        if (version === epoch) clearSource();
        throw new RealPlaybackError();
      } finally { copy.fill(0); }
    },
    stop,
    async dispose() {
      closed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
      await stop();
      await context?.close().catch(() => {});
      context = null;
      element = null;
    },
  };
}
