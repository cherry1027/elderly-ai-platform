import type { RealScope, decodeLiveTalkSaved } from './api';
import type { AudioRecording } from '../api/audio-transcripts';

export type LiveTalkRecording = { recording: AudioRecording; dispose(): Promise<void> };

export type LiveChunk = (pcm: Uint8Array, submittedAt: number) => void;
export interface LiveTalkDriver {
  stopInput(): void;
  dispose(): void;
  takeRecording?(): Promise<LiveTalkRecording | null>;
  run(scope: RealScope, key: string, events: {
    onOperation(id: string): void; onReady(): void; onLimitReached(): void;
    onInputStopped(): void; onVoice: LiveChunk; onSaving(): void;
  }): Promise<ReturnType<typeof decodeLiveTalkSaved>>;
}

export function createLiveTalk(): LiveTalkDriver | null { return null; }
