import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';

type OwnedFile = { readonly uri: string; readonly exists: boolean; readonly size: number;
  create(): void; write(bytes: Uint8Array): Promise<void>; delete(): void };
type Player = { play(): void; pause(): void; remove(): void;
  addListener(event: 'playbackStatusUpdate', callback: (value: { didJustFinish: boolean }) => void): { remove(): void } };
export interface PlaybackDependencies {
  foreground(): boolean; mode(): Promise<void>; file(): OwnedFile; player(uri: string): Player;
}
export interface RealPlayback {
  prepare?(): void;
  play(bytes: Uint8Array, onFinish: () => void): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
export class RealPlaybackError extends Error {
  constructor() { super('The spoken reply could not be played safely.'); this.name = 'RealPlaybackError'; }
}
const DIRECTORY = 'memy-private-spoken-replies-v1';
let nativeOwner: object | null = null;
const dependencies: PlaybackDependencies = {
  foreground: () => AppState.currentState === 'active',
  mode: () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false,
    interruptionMode: 'doNotMix' }),
  file: () => {
    const directory = new Directory(Paths.cache, DIRECTORY);
    if (!directory.exists) directory.create();
    // Remove only this adapter's old cache files after a process restart.
    const entries = directory.list();
    if (entries.length > 128) throw new RealPlaybackError();
    for (const entry of entries) {
      if (!(entry instanceof File) || !/^reply-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.wav$/i.test(entry.name)) continue;
      const owned = new File(directory, entry.name);
      if (entry.uri !== owned.uri) throw new RealPlaybackError();
      if (entry.exists) entry.delete();
    }
    const id = randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new RealPlaybackError();
    return new File(directory, `reply-${id}.wav`);
  },
  player: uri => createAudioPlayer({ uri }, { keepAudioSessionActive: false, allowsExternalPlayback: false }),
};

/** A revocable, foreground-only audio lease. Disk files never contain credentials or story titles. */
export function createRealPlayback(injected: PlaybackDependencies = dependencies): RealPlayback {
  const owner = {}, native = injected === dependencies;
  let closed = false, epoch = 0, queue = Promise.resolve();
  let file: OwnedFile | null = null, player: Player | null = null, listener: { remove(): void } | null = null;
  const serial = <T,>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(action, action); queue = next.then(() => undefined, () => undefined); return next;
  };
  const clean = () => {
    let failed = false;
    try { listener?.remove(); listener = null; } catch { failed = true; }
    try { player?.pause(); } catch { failed = true; }
    try { player?.remove(); player = null; } catch { failed = true; }
    try { if (file?.exists) file.delete(); file = null; } catch { failed = true; }
    if (failed) throw new RealPlaybackError();
    if (native && nativeOwner === owner) nativeOwner = null;
  };
  const stop = () => {
    epoch++;
    // Pause synchronously before a recorder/sign-out action can proceed.
    try { player?.pause(); } catch { /* queued cleanup reports failure */ }
    return serial(async () => { clean(); });
  };
  return {
    play(bytes, onFinish) {
      const version = ++epoch;
      if (closed || !injected.foreground() || !(bytes instanceof Uint8Array) || bytes.length < 44 || bytes.length > 10_000_000 ||
        String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') return Promise.reject(new RealPlaybackError());
      const copy = Uint8Array.from(bytes);
      return serial(async () => {
        const check = () => { if (closed || epoch !== version || !injected.foreground()) throw new RealPlaybackError(); };
        try {
          clean(); check();
          if (native) { if (nativeOwner && nativeOwner !== owner) throw new RealPlaybackError(); nativeOwner = owner; }
          await injected.mode(); check();
          file = injected.file(); file.create(); await file.write(copy); check();
          if (!file.exists || file.size !== copy.length) throw new RealPlaybackError();
          player = injected.player(file.uri);
          listener = player.addListener('playbackStatusUpdate', state => {
            if (!state.didJustFinish || epoch !== version || closed) return;
            const stopped = stop(), stoppedEpoch = epoch;
            void stopped.then(() => { if (!closed && epoch === stoppedEpoch && injected.foreground()) onFinish(); }, () => {});
          });
          check(); player.play();
        } catch {
          try { clean(); } catch { /* preserve sanitized failure */ } throw new RealPlaybackError();
        } finally { copy.fill(0); }
      });
    },
    stop,
    dispose() { closed = true; return stop(); },
  };
}
