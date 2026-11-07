/** Browser recording ownership. Audio never enters persistent storage. */
import type { AudioRecording } from '../api/audio-transcripts';

type Entry = { owner: object; blob: Blob; recording: AudioRecording };
const entries = new Map<string, Entry>();
export function saveBrowserRecording(blob: Blob, owner: object, durationMs: number): AudioRecording {
  const type = blob.type.split(';')[0].trim().toLowerCase();
  if (!['audio/webm', 'audio/mp4'].includes(type) || blob.size < 1 || blob.size > 25_000_000 ||
      !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 60_000) throw new Error('Recording is unavailable.');
  const normalized = new Blob([blob], { type });
  const uri = URL.createObjectURL(normalized);
  const recording: AudioRecording = Object.freeze({ uri, name: type === 'audio/webm' ? 'recording.webm' : 'recording.m4a',
    type: type as 'audio/webm' | 'audio/mp4', size: normalized.size, durationMs });
  entries.set(uri, { owner, blob: normalized, recording });
  return recording;
}
export function getBrowserRecordingBlob(recording: AudioRecording): Blob {
  const entry = entries.get(recording?.uri);
  if (!entry || Object.keys(entry.recording).some(key => entry.recording[key as keyof AudioRecording] !== recording[key as keyof AudioRecording])) {
    throw new Error('Recording is unavailable.');
  }
  return entry.blob;
}
export function discardBrowserRecording(recording: AudioRecording, owner: object): void {
  const entry = entries.get(recording.uri);
  if (entry?.owner !== owner) return;
  URL.revokeObjectURL(recording.uri); entries.delete(recording.uri);
}
export function clearBrowserRecordings(owner: object): void {
  for (const entry of entries.values()) if (entry.owner === owner) discardBrowserRecording(entry.recording, owner);
}
