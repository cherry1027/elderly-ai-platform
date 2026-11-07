import type { AudioRecording } from '../api/audio-transcripts';
import { getBrowserRecordingBlob } from './browser-recordings';
import { readWebStaging } from '../web-staging';

/** Only the exact foreground capture registered by this app can be uploaded. */
export function createRecordingUpload(recording: AudioRecording, language: 'en' | 'sv', invalid: () => never): FormData {
  if (!readWebStaging() || document.visibilityState === 'hidden' || !['en', 'sv'].includes(language)) invalid();
  let blob: Blob;
  try { blob = getBrowserRecordingBlob(recording); } catch { return invalid(); }
  const body = new FormData();
  body.append('file', blob, recording.name);
  body.append('language', language); body.append('consent', 'true');
  return body;
}
