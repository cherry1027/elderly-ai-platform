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
  const foreground = () => typeof document !== 'undefined' && document.visibilityState !== 'hidden';
  const clean = () => {
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (audioOwner === owner) audioOwner = null;
  };
  const serial = <T,>(action: () => Promise<T>) => { const next = queue.then(action, action); queue = next.then(() => undefined, () => undefined); return next; };
  const stop = () => { epoch++; audio?.pause(); return serial(async () => clean()); };
  const background = () => { if (!foreground()) void stop(); };
  const pageHide = () => { void stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', background);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide);
  return {
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
          url = URL.createObjectURL(new Blob([copy.buffer], { type: 'audio/wav' }));
          audio = new Audio(url); audio.preload = 'none';
          audio.onended = () => { if (closed || version !== epoch) return; void stop().then(() => { if (!closed && foreground()) onFinish(); }); };
          audio.onerror = () => { if (version === epoch) void stop().then(() => { if (!closed && foreground()) onFinish(); }); };
          await audio.play(); check();
        } catch { clean(); throw new RealPlaybackError(); }
        finally { copy.fill(0); }
      });
    },
    stop,
    dispose() {
      closed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', background);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
      return stop();
    },
  };
}
