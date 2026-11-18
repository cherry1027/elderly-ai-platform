import { normalizeMobileApiBaseUrl, validateStoryProjectId } from '../api/story-projects';
import { decodeLiveTalkSaved, isTalkPreview, RealAiError } from './api';
import type { LiveTalkDriver } from './live-talk';
import { SPEECH_CHUNK_BYTES, SPEECH_SAMPLE_RATE } from './voice-pcm';

const API_ORIGIN = 'https://memy-pilot-api.onrender.com';
const MAX_CAPTURE_SECONDS = 60;
const MAX_CAPTURE_BYTES = MAX_CAPTURE_SECONDS * SPEECH_SAMPLE_RATE * 2;
const MAX_REPLY_BYTES = SPEECH_SAMPLE_RATE * 2 * 20;

export function createLiveTalk(): LiveTalkDriver | null {
  if (!isTalkPreview() || !navigator.mediaDevices?.getUserMedia || typeof WebSocket !== 'function') return null;
  const AudioEngine = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioEngine) return null;
  const capture = new AudioEngine();
  const resumed = capture.resume(); void resumed.catch(() => {});
  let media: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined, mute: GainNode | undefined, socket: WebSocket | undefined;
  let microphoneClosed = false, closed = false, sending = false, submittedAt: number | undefined;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  let onInputStopped: (() => void) | undefined;

  function releaseMicrophone() {
    if (microphoneClosed) return;
    microphoneClosed = true;
    sending = false;
    clearTimeout(captureTimer);
    if (processor) processor.onaudioprocess = null;
    source?.disconnect(); processor?.disconnect(); mute?.disconnect();
    media?.getTracks().forEach(track => track.stop());
    void capture.close().catch(() => {});
  }

  function stopInput() {
    if (closed || submittedAt !== undefined || !onInputStopped || socket?.readyState !== WebSocket.OPEN) return;
    submittedAt = performance.now();
    releaseMicrophone();
    socket.send('stop');
    onInputStopped();
  }

  function dispose() {
    if (closed) return;
    closed = true;
    releaseMicrophone();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  return {
    stopInput, dispose,
    async run(scope, key, events) {
      if (normalizeMobileApiBaseUrl(scope.baseUrl) !== API_ORIGIN || !['en', 'sv'].includes(scope.language) || closed) {
        dispose(); throw new RealAiError('configuration');
      }
      const id = validateStoryProjectId(scope.sessionId);
      const signal = scope.signal;
      let operation: string | undefined;
      const interrupted = () => new RealAiError('network', undefined, !!operation, undefined, undefined, operation);
      const abort = () => dispose();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) throw interrupted();
        media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        if (closed || microphoneClosed) { media.getTracks().forEach(track => track.stop()); throw interrupted(); }
        await resumed;
        const token = await scope.getAccessToken();
        if (!token) throw new RealAiError('authentication');
        if (closed || signal?.aborted || microphoneClosed) throw interrupted();
        return await new Promise((resolve, reject) => {
          const ws = new WebSocket(`wss://memy-pilot-api.onrender.com/api/v2/story-sessions/${id}/live-talk?talk_preview=true`);
          socket = ws;
          ws.binaryType = 'arraybuffer';
          let ready = false, terminal = false, replyBytes = 0;
          const timeout = setTimeout(() => fail(interrupted()), 115_000);
          function finish(error?: unknown, saved?: ReturnType<typeof decodeLiveTalkSaved>) {
            if (terminal) return;
            terminal = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else if (saved) resolve(saved);
            else reject(interrupted());
          }
          function fail(error: unknown) { finish(error); dispose(); }
          ws.onopen = () => {
            if (closed || signal?.aborted) { fail(interrupted()); return; }
            ws.send(JSON.stringify({ token, key: validateStoryProjectId(key) }));
          };
          ws.onclose = () => finish(interrupted());
          ws.onerror = () => fail(interrupted());
          ws.onmessage = event => {
            if (terminal || closed || signal?.aborted) return;
            try {
              if (event.data instanceof ArrayBuffer) {
                const packet = new Uint8Array(event.data);
                if (!ready || !operation || !packet.length || packet.length % 2) throw interrupted();
                if (submittedAt === undefined) { packet.fill(0); return; }
                replyBytes += packet.length;
                if (replyBytes > MAX_REPLY_BYTES) throw interrupted();
                for (let offset = 0; offset < packet.length; offset += SPEECH_CHUNK_BYTES) {
                  events.onVoice(packet.subarray(offset, offset + SPEECH_CHUNK_BYTES), submittedAt);
                }
                packet.fill(0);
                return;
              }
              if (typeof event.data !== 'string' || event.data.length > 350_000) throw interrupted();
              const item = JSON.parse(event.data);
              if (item.type === 'operation' && !operation) {
                operation = validateStoryProjectId(item.id); events.onOperation(operation);
              } else if (item.type === 'ready' && operation && !ready && !microphoneClosed) {
                ready = true; sending = true;
                onInputStopped = events.onInputStopped;
                source = capture.createMediaStreamSource(media!);
                processor = capture.createScriptProcessor(2048, 1, 1);
                mute = capture.createGain(); mute.gain.value = 0;
                let phase = 0, sum = 0, count = 0, sentBytes = 0;
                const reachLimit = () => {
                  if (microphoneClosed) return;
                  releaseMicrophone(); events.onLimitReached();
                };
                processor.onaudioprocess = frame => {
                  if (!sending || ws.readyState !== WebSocket.OPEN) return;
                  if (ws.bufferedAmount > 48_000) { fail(interrupted()); return; }
                  const values = frame.inputBuffer.getChannelData(0);
                  const bytes = new ArrayBuffer(Math.ceil(values.length * SPEECH_SAMPLE_RATE / capture.sampleRate + 1) * 2);
                  const pcm = new DataView(bytes);
                  let size = 0;
                  for (const value of values) {
                    sum += value; count++;
                    phase += SPEECH_SAMPLE_RATE;
                    while (phase >= capture.sampleRate) {
                      pcm.setInt16(size, Math.round(Math.max(-1, Math.min(1, count ? sum / count : value)) * 32767), true);
                      size += 2; phase -= capture.sampleRate; sum = 0; count = 0;
                    }
                  }
                  const sendSize = Math.min(size, MAX_CAPTURE_BYTES - sentBytes);
                  if (sendSize) ws.send(bytes.slice(0, sendSize));
                  sentBytes += sendSize;
                  if (sentBytes === MAX_CAPTURE_BYTES) reachLimit();
                };
                source.connect(processor); processor.connect(mute); mute.connect(capture.destination);
                captureTimer = setTimeout(reachLimit, MAX_CAPTURE_SECONDS * 1000);
                events.onReady();
              } else if (item.type === 'saving' && submittedAt !== undefined && operation) {
                events.onSaving();
              } else if (item.type === 'saved' && submittedAt !== undefined && operation) {
                finish(undefined, decodeLiveTalkSaved(item, scope));
              } else if (item.type === 'error') {
                const code = typeof item.code === 'string' && /^[A-Z_]{1,64}$/.test(item.code) ? item.code : undefined;
                if (code === 'INVALID_ACCESS_TOKEN' || code === 'AUTHORIZATION_REQUIRED') throw new RealAiError('authentication', 401);
                if (code === 'LIVE_TALK_NO_SPEECH') throw new RealAiError('validation', 422, false, code);
                throw new RealAiError('unavailable', undefined, !!operation, code, undefined, operation);
              } else throw interrupted();
            } catch (error) { fail(error); }
          };
        });
      } finally {
        signal?.removeEventListener('abort', abort);
        dispose();
      }
    },
  };
}
