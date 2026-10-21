import {
  AudioTranscriptError, listSessionTranscripts, SIMULATED_TRANSCRIPT_NOTICE, uploadSessionRecording,
  type AudioRecording, type AudioTranscript, type UploadSessionRecordingOptions,
} from '../src/api/audio-transcripts';
import { StoryProjectsError } from '../src/api/story-projects';

const baseUrl = 'http://192.168.20.40:8000';
const sessionId = '20000000-0000-4000-8000-000000000001';
const nextSessionId = '20000000-0000-4000-8000-000000000002';
const key = '30000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature';
const clip: AudioRecording = {
  uri: 'file:///fictional-private-cache/clip.m4a', name: 'recording.m4a', type: 'audio/mp4', size: 6400, durationMs: 5000,
};
const originalFormData = globalThis.FormData;
class CapturedFormData {
  readonly parts: [string, unknown][] = [];
  append(name: string, value: unknown) { this.parts.push([name, value]); }
}
function row(language: 'en' | 'sv' = 'en', overrides: Partial<AudioTranscript> = {}): AudioTranscript {
  return { transcript_id: '40000000-0000-4000-8000-000000000001', session_id: sessionId, language,
    text: SIMULATED_TRANSCRIPT_NOTICE + (language === 'sv' ? 'Fiktivt svenskt exempel.' : 'Fictional English sample.'),
    status: 'completed', created_at: '2026-10-21T12:34:56.123456Z', ...overrides };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response(row()));
  const getAccessToken = jest.fn(async (): Promise<string | null> => token);
  const options = { baseUrl, request, getAccessToken, sessionId, expectedLanguage: 'en' as const };
  return { request, getAccessToken,
    upload: (overrides: Partial<UploadSessionRecordingOptions> = {}) =>
      uploadSessionRecording({ ...options, recording: clip, idempotencyKey: key, consent: true, ...overrides }),
    list: () => listSessionTranscripts(options) };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
beforeEach(() => { globalThis.FormData = CapturedFormData as unknown as typeof FormData; });
afterEach(() => { globalThis.FormData = originalFormData; jest.useRealTimers(); });

describe('authenticated simulated audio API, synthetic transport only', () => {
  it.each(['en', 'sv'] as const)('posts actual native descriptor parts for the session language %s', async language => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(row(language)));
    await expect(f.upload({ expectedLanguage: language })).resolves.toEqual(row(language));
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.getAccessToken).toHaveBeenCalledTimes(1);
    const [url, init] = f.request.mock.calls[0];
    expect(url).toBe(baseUrl + '/api/v1/story-sessions/' + sessionId + '/transcribe');
    expect(init).toMatchObject({ method: 'POST', headers: {
      Authorization: 'Bearer ' + token, Accept: 'application/json', 'Idempotency-Key': key,
    }, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(init?.headers).not.toHaveProperty('Content-Type');
    expect((init?.body as unknown as CapturedFormData).parts).toEqual([
      ['file', { name: 'recording.m4a', type: 'audio/mp4', bytes: expect.any(Function) }],
      ['language', language], ['consent', 'true'],
    ]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retains exact key, URI, filename and language for an explicit uncertain retry', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('private failure'));
    await expect(f.upload()).rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
    expect(f.request).toHaveBeenCalledTimes(1);
    await expect(f.upload()).resolves.toEqual(row());
    expect(f.request).toHaveBeenCalledTimes(2);
    for (const [, init] of f.request.mock.calls) {
      expect(init?.headers).toHaveProperty('Idempotency-Key', key);
      expect((init?.body as unknown as CapturedFormData).parts).toEqual([
        ['file', { name: 'recording.m4a', type: 'audio/mp4', bytes: expect.any(Function) }], ['language', 'en'], ['consent', 'true'],
      ]);
    }
  });

  it('reads completed history without writes, additional keys or transcript rewriting', async () => {
    const f = fixture();
    const rows = [row(), row('en', { transcript_id: '40000000-0000-4000-8000-000000000002',
      text: SIMULATED_TRANSCRIPT_NOTICE + '  Fictional whitespace is retained.\n' })];
    f.request.mockResolvedValueOnce(response(rows));
    await expect(f.list()).resolves.toEqual(rows);
    expect(f.request).toHaveBeenCalledWith(baseUrl + '/api/v1/story-sessions/' + sessionId + '/transcripts?limit=50&offset=0', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    });
  });

  it('returns an empty history without pretending an upload succeeded', async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(response([]));
    await expect(f.list()).resolves.toEqual([]);
    expect(f.request.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([
    { sessionId: 'bad' }, { expectedLanguage: 'de' }, { idempotencyKey: '' },
    { idempotencyKey: 'not-a-uuid' }, { consent: false }, { consent: 'true' },
    { recording: null }, { recording: { ...clip, name: 'clip.wav' } },
    { recording: { ...clip, type: 'audio/aac' } }, { recording: { ...clip, type: 'audio/mp4; codecs=aac' } },
    { recording: { ...clip, size: 0 } }, { recording: { ...clip, size: 25_000_001 } },
    { recording: { ...clip, size: 0.5 } }, { recording: { ...clip, size: NaN } },
    { recording: { ...clip, durationMs: 0 } }, { recording: { ...clip, durationMs: 90_001 } },
    { recording: { ...clip, durationMs: Infinity } },
    { recording: { ...clip, uri: 'https://private.example.test/clip.m4a' } },
    { recording: { ...clip, uri: 'file://host/clip.m4a' } },
    { recording: { ...clip, uri: 'file:///cache/clip.aac' } },
    { recording: { ...clip, uri: 'file:///cache/../clip.m4a' } },
    { recording: { ...clip, uri: 'file:///cache/%2e%2e/clip.m4a' } },
    { recording: { ...clip, uri: 'file:///cache/clip.m4a?token=private' } },
    { recording: { ...clip, uri: 'file:///cache/clip%00.m4a' } },
    { recording: { ...clip, uri: 'file:///cache/%xx.m4a' } },
  ])('rejects invalid input %# before token acquisition or transport', async overrides => {
    const f = fixture();
    await expect(f.upload(overrides as Partial<UploadSessionRecordingOptions>)).rejects.toMatchObject({ kind: 'validation' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('accepts bounded M4A metadata while leaving authoritative byte decoding to the server', async () => {
    const f = fixture();
    await expect(f.upload({ recording: { ...clip, size: 25_000_000, durationMs: 90_000 } })).resolves.toEqual(row());
  });

  it.each([null, '', 'sb_publishable_synthetic', 'sb_secret_synthetic'])('rejects unusable user credentials %s', async badToken => {
    const f = fixture(); f.getAccessToken.mockResolvedValueOnce(badToken);
    await expect(f.upload()).rejects.toMatchObject({ kind: 'authentication' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('rejects unsafe API origins before token acquisition', async () => {
    const f = fixture();
    await expect(f.upload({ baseUrl: 'https://edbkuunyeyxnyenmmqud.supabase.co' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'INVALID_ACCESS_TOKEN', 'authentication'], [403, 'ACCESS_DENIED', 'forbidden'],
    [404, 'SESSION_NOT_FOUND', 'not-found'], [408, 'UPLOAD_TIMEOUT', 'timeout'],
    [409, 'SESSION_COMPLETED', 'conflict'], [409, 'TRANSCRIPTION_IN_PROGRESS', 'conflict'],
    [409, 'TRANSCRIPTION_CONFLICT', 'conflict'], [413, 'RECORDING_TOO_LARGE', 'validation'],
    [415, 'UNSUPPORTED_AUDIO_FORMAT', 'validation'], [422, 'LANGUAGE_MISMATCH', 'validation'],
    [422, 'CONSENT_REQUIRED', 'validation'], [429, 'AUDIO_BUSY', 'unavailable'],
    [503, 'TRANSCRIPTION_DISABLED', 'unavailable'], [503, 'SUPABASE_UNAVAILABLE', 'unavailable'],
    [504, 'TRANSCRIPTION_TIMEOUT', 'timeout'],
  ] as const)('safely classifies %s %s', async (status, code, kind) => {
    const f = fixture();
    f.request.mockResolvedValueOnce(response({ error: { code, message: token + ' private transcript' } }, status));
    await expect(f.upload()).rejects.toMatchObject({ name: 'AudioTranscriptError', kind, status, code,
      mayHaveWritten: status >= 500 && code !== 'TRANSCRIPTION_DISABLED' });
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['UNRECOGNIZED_PRIVATE_CODE', 503], ['TRANSCRIPTION_DISABLED', 401],
    ['__proto__', 503], ['constructor', 503],
  ] as const)('drops unknown or mismatched code %s', async (code, status) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response({ error: { code, message: token } }, status));
    let actual: unknown;
    try { await f.upload(); } catch (error) { actual = error; }
    expect(actual).toBeInstanceOf(AudioTranscriptError);
    expect((actual as AudioTranscriptError).code).toBeUndefined();
    expect(String(actual)).not.toContain(token); expect(String(actual)).not.toContain(code);
  });

  it.each(['text/html', 'application/json'])('handles non-JSON or malformed error bodies safely (%s)', async contentType => {
    const f = fixture();
    f.request.mockResolvedValueOnce(new Response('private upstream details ' + token,
      { status: 503, headers: { 'Content-Type': contentType } }));
    const pending = f.upload();
    await expect(pending).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(pending.catch((error: AudioTranscriptError) => error.code)).resolves.toBeUndefined();
  });

  it.each([
    {}, { ...row(), session_id: nextSessionId }, { ...row(), language: 'sv' }, { ...row(), status: 'processing' },
    { ...row(), transcript_id: 'bad' }, { ...row(), created_at: '2026-02-30T12:00:00Z' },
    { ...row(), text: 'Unlabelled original must not be claimed as simulation.' },
    { ...row(), text: SIMULATED_TRANSCRIPT_NOTICE }, { ...row(), text: SIMULATED_TRANSCRIPT_NOTICE + '\0' },
    { ...row(), text: SIMULATED_TRANSCRIPT_NOTICE + '\ud800' },
    { ...row(), text: SIMULATED_TRANSCRIPT_NOTICE + 'x'.repeat(32_001) }, { ...row(), private_field: token },
  ])('rejects malformed or unlabelled successful transcript %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.upload()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });

  it.each(['transcript_id', 'session_id', 'language', 'text', 'status', 'created_at'])('requires response field %s', async field => {
    const data: Record<string, unknown> = { ...row() }; delete data[field];
    const f = fixture(); f.request.mockResolvedValueOnce(response(data));
    await expect(f.upload()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([201, 202, 204])('does not assume success for HTTP %s', async status => {
    const f = fixture(); f.request.mockResolvedValueOnce({ status, ok: true } as Response);
    await expect(f.upload()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  });

  it('rejects malformed success JSON and non-JSON success without exposing contents', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(new Response('private ' + token, { headers: { 'Content-Type': 'application/json' } }));
    await expect(f.upload()).rejects.toMatchObject({ kind: 'invalid-response' });
    f.request.mockResolvedValueOnce(new Response('private ' + token, { headers: { 'Content-Type': 'text/html' } }));
    await expect(f.upload()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([[row(), row()], Array.from({ length: 51 }, () => row()), {}, [null]].map(value => [value] as const))('rejects malformed history %#', async value => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(value));
    await expect(f.list()).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: false });
  });

  it('uses a 60-second upload budget, not the 10-second metadata default', async () => {
    jest.useFakeTimers(); const f = fixture();
    f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.upload();
    const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
    await flush(); await jest.advanceTimersByTimeAsync(59_999);
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1); await checked;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains the 10-second history budget', async () => {
    jest.useFakeTimers(); const f = fixture();
    f.request.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.list(); const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: false });
    await flush(); await jest.advanceTimersByTimeAsync(10_000); await checked;
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['token', 'request', 'body', 'error-body'])('times out safely during %s even if abort is ignored', async stage => {
    jest.useFakeTimers(); const f = fixture();
    if (stage === 'token') f.getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'request') f.request.mockImplementationOnce(() => new Promise(() => {}));
    if (stage === 'body' || stage === 'error-body') f.request.mockResolvedValueOnce({
      status: stage === 'body' ? 200 : 503, ok: stage === 'body',
      headers: new Headers({ 'Content-Type': 'application/json' }), text: () => new Promise(() => {}),
    } as unknown as Response);
    const pending = f.upload({ timeoutMs: 25 });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: stage !== 'token' });
    await flush(); await jest.advanceTimersByTimeAsync(25); await checked;
    if (stage === 'token') expect(f.request).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never dispatches after a late token resolves following cancellation', async () => {
    const f = fixture(); const controller = new AbortController();
    let resolve!: (value: string) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.upload({ signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: false });
    controller.abort(); await checked; resolve(token); await flush();
    expect(f.request).not.toHaveBeenCalled();
  });

  it('does not read or publish late response bodies after navigation cancellation', async () => {
    const f = fixture(); const controller = new AbortController(); let resolve!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = f.upload({ signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mayHaveWritten: true });
    await flush(); controller.abort(); await checked;
    const text = jest.fn(async () => JSON.stringify(row()));
    resolve({ status: 200, ok: true, text } as unknown as Response); await flush();
    expect(text).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('sanitizes exceptions and never logs audio, transcripts, tokens or raw failures', async () => {
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    try {
      const f = fixture(); f.request.mockRejectedValueOnce(new Error(token + ' private recording private transcript'));
      await expect(f.upload()).rejects.toEqual(new StoryProjectsError('network', undefined, true));
      logs.forEach(log => expect(log).not.toHaveBeenCalled());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
