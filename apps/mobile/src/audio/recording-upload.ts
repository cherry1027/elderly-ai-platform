import { File } from 'expo-file-system';
import { validateRecording, type AudioRecording } from '../api/audio-transcripts';

/** Native bytes are still validated lazily inside the single dispatched upload. */
export function createRecordingUpload(recording: AudioRecording, language: 'en' | 'sv', invalid: () => never): FormData {
  validateRecording(recording);
  const body = new FormData();
  body.append('file', { name: 'recording.m4a', type: 'audio/mp4', bytes: async () => {
    const file = new File(recording.uri);
    if (!file.exists || file.size !== recording.size) invalid();
    const bytes = await file.bytes();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== recording.size) invalid();
    return bytes;
  } } as unknown as Blob);
  body.append('language', language); body.append('consent', 'true');
  return body;
}
