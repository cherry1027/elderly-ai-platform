export const SPEECH_SAMPLE_RATE = 24_000;
export const SPEECH_CHUNK_BYTES = 12_000;
export const MAX_SPEECH_PCM_BYTES = 45 * SPEECH_SAMPLE_RATE * 2;
const WAV_HEADER_BYTES = 44;

export function speechWav(chunks: readonly Uint8Array[], pcmBytes: number): Uint8Array<ArrayBuffer> {
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcmBytes);
  const view = new DataView(wav.buffer);
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, wav.length - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_SAMPLE_RATE, true);
  view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, pcmBytes, true);
  let offset = WAV_HEADER_BYTES;
  for (const chunk of chunks) { wav.set(chunk, offset); offset += chunk.length; }
  return wav;
}
