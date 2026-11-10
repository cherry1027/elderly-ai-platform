/** Foreground-only browser playback. Audio uses revocable RAM Blob URLs, never storage. */
import type { RealPlayback } from './native-playback';
export type { RealPlayback, PlaybackDependencies } from './native-playback';
export class RealPlaybackError extends Error {
  constructor() { super('The spoken reply could not be played safely.'); this.name = 'RealPlaybackError'; }
}
let audioOwner: object | null = null;
export function createRealPlayback(): RealPlayback {
  const owner = {}; let closed = false, epoch = 0, queue = Promise.resolve();
  let audio: HTMLAudioElement | null = null, url: string | null = null;
  let context: AudioContext | null = null, source: AudioBufferSourceNode | null = null;
  const foreground = () => typeof document !== 'undefined' && document.visibilityState !== 'hidden';
  const stopSource = () => {
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
      source = null;
    }
  };
  const clean = () => {
    stopSource();
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (audioOwner === owner) audioOwner = null;
  };
  const serial = <T,>(action: () => Promise<T>) => { const next = queue.then(action, action); queue = next.then(() => undefined, () => undefined); return next; };
  const stop = () => { epoch++; audio?.pause(); stopSource(); return serial(async () => clean()); };
  const background = () => { if (!foreground()) void stop(); };
  const pageHide = () => { void stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);
  return {
    prepare() {
      if (closed || !foreground() || typeof AudioContext === 'undefined') return;
      // Resume during the user's tap so the reply can play after the network turn.
      try {
        context ??= new AudioContext();
        void context.resume().catch(() => {});
      } catch { /* HTML audio remains available */ }
    },
    play(bytes, onFinish) {
      const version = ++epoch;
      if (closed || !foreground() || typeof Audio === 'undefined' || !(bytes instanceof Uint8Array) || bytes.length < 44 || bytes.length > 10_000_000 ||
          String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') return Promise.reject(new RealPlaybackError());
      const copy = new Uint8Array(bytes.length); copy.set(bytes);
      return serial(async () => {
        const check = () => { if (closed || version !== epoch || !foreground()) throw new RealPlaybackError(); };
        try {
          clean(); check();
          if (audioOwner && audioOwner !== owner) throw new RealPlaybackError(); audioOwner = owner;
          const finish = () => {
            if (closed || version !== epoch) return;
            const cleanup = stop(), finished = epoch;
            void cleanup.then(() => { if (!closed && epoch === finished && foreground()) onFinish(); });
          };
          if (context?.state === 'running') {
            let decoded: AudioBuffer | null = null;
            try { decoded = await context.decodeAudioData(copy.buffer.slice(0)); } catch { /* try HTML audio */ }
            check();
            if (decoded && context.state === 'running') {
              source = context.createBufferSource();
              source.buffer = decoded;
              source.connect(context.destination);
              source.onended = finish;
              source.start();
              return;
            }
          }
          url = URL.createObjectURL(new Blob([copy.buffer], { type: 'audio/wav' }));
          audio = new Audio(url); audio.preload = 'none';
          audio.onended = finish;
          audio.onerror = finish;
          await audio.play(); check();
        } catch { clean(); throw new RealPlaybackError(); }
        finally { copy.fill(0); }
      });
    },
    stop,
    async dispose() {
      closed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
      await stop();
      const previous = context; context = null;
      if (previous && previous.state !== 'closed') await previous.close();
    },
  };
}
