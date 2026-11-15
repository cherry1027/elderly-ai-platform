/** The browser player keeps one foreground-only media element per workspace. */
import type { RealPlayback } from './native-playback';
export type { RealPlayback, PlaybackDependencies } from './native-playback';
export class RealPlaybackError extends Error {
  constructor() { super('The spoken reply could not be played safely.'); this.name = 'RealPlaybackError'; }
}

let audioOwner: object | null = null;

function silentPrimer(): Blob {
  // 50 ms of zero-valued 16-bit mono PCM. A Blob URL follows the web CSP and
  // allows us to prime the unmuted element without networking or a recording.
  const sampleRate = 24000, pcmBytes = sampleRate / 10;
  const wav = new ArrayBuffer(44 + pcmBytes), view = new DataView(wav);
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, wav.byteLength - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, pcmBytes, true);
  return new Blob([wav], { type: 'audio/wav' });
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
  const stop = async () => { epoch++; clearSource(); };
  const background = () => { if (!foreground()) void stop(); };
  const pageHide = () => { void stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);

  return {
    prepare() {
      if (closed || !foreground() || typeof Audio === 'undefined' || (audioOwner && audioOwner !== owner)) return;
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
    async play(bytes, onFinish, onError) {
      if (closed || !foreground() || typeof Audio === 'undefined' || !(bytes instanceof Uint8Array) ||
          bytes.length < 44 || bytes.length > 10_000_000 ||
          String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
          String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') throw new RealPlaybackError();
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
      element = null;
    },
  };
}
