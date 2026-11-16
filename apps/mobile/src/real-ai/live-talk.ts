import type { RealScope, decodeLiveTalkSaved } from './api';

export type LiveChunk = (pcm: Uint8Array, heardAt: number | undefined) => void;
export interface LiveTalkDriver {
  stopInput(): void;
  dispose(): void;
  run(scope: RealScope, key: string, events: {
    onOperation(id: string): void; onReady(): void; onVoice: LiveChunk; onSaving(): void;
  }): Promise<ReturnType<typeof decodeLiveTalkSaved>>;
}

export function createLiveTalk(): LiveTalkDriver | null { return null; }
