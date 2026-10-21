import { File } from 'expo-file-system';
import { AudioTranscriptError, type AudioUploadDiagnostic, uploadSessionRecording, SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';

// Actual installed SDK serialization; only disk access and the HTTP boundary are mocked.
const { installFormDataPatch } = jest.requireActual('../node_modules/expo/src/winter/FormData');
const { normalizeBodyInitAsync } = jest.requireActual('../node_modules/expo/src/winter/fetch/RequestUtils');
const NativeFormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
const ExpoFormData = installFormDataPatch(NativeFormData);
const originalFormData = globalThis.FormData;
const sessionId = '20000000-0000-4000-8000-000000000001';
const idempotencyKey = '30000000-0000-4000-8000-000000000001';
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 255]);
const recording = { uri: 'file:///fictional-cache/recording-original.m4a',
  name: 'recording.m4a' as const, type: 'audio/mp4' as const, size: bytes.length, durationMs: 8000 };
const token = 'synthetic.access-token.signature';
const transcript = { transcript_id: '40000000-0000-4000-8000-000000000001', session_id: sessionId,
  language: 'en', text: SIMULATED_TRANSCRIPT_NOTICE + 'Fictional sample.',
  status: 'completed', created_at: '2026-10-21T12:00:00Z' };
const fileBytes = jest.fn(async () => bytes);
const file = { exists: true, size: bytes.length, bytes: fileBytes };
function fixture(language: 'en' | 'sv' = 'en') {
  const wire = jest.fn();
  const request = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const normalized = await normalizeBodyInitAsync(init?.body);
    // This is a fake boundary: no native HTTP, microphone or real file is used.
    if (init?.signal?.aborted) throw new Error('Aborted');
    wire(normalized);
    return new Response(JSON.stringify({ ...transcript, language }), { headers: { 'Content-Type': 'application/json' } });
  }) as unknown as jest.MockedFunction<typeof fetch>;
  return { wire, request, upload: (overrides = {}) => uploadSessionRecording({
    baseUrl: 'http://192.168.20.40:8000', sessionId, expectedLanguage: language, idempotencyKey,
    consent: true, recording, getAccessToken: async () => token, request, ...overrides,
  }) };
}
beforeEach(() => {
  globalThis.FormData = ExpoFormData;
  file.exists = true; file.size = bytes.length;
  fileBytes.mockReset().mockResolvedValue(bytes);
  jest.mocked(File).mockReset().mockImplementation(() => file as unknown as File);
});
afterEach(() => { globalThis.FormData = originalFormData; jest.useRealTimers(); });

it('reproduces the old SDK57 URI-only failure before transmission', async () => {
  const body = new FormData();
  body.append('file', { uri: recording.uri, name: recording.name, type: recording.type } as unknown as Blob);
  const wire = jest.fn();
  await expect(normalizeBodyInitAsync(body).then(wire)).rejects.toThrow('Unsupported FormDataPart implementation');
  expect(wire).not.toHaveBeenCalled(); expect(fileBytes).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('serializes real synthetic M4A bytes with the SDK boundary and exact %s fields', async language => {
  const f = fixture(language);
  await expect(f.upload()).resolves.toEqual({ ...transcript, language });
  expect(f.wire).toHaveBeenCalledTimes(1);
  expect(fileBytes).toHaveBeenCalledTimes(1);
  expect(File).toHaveBeenCalledWith(recording.uri);
  const normalized = f.wire.mock.calls[0][0];
  const contentType = normalized.overriddenHeaders.find(([name]: string[]) => name === 'Content-Type')[1];
  expect(contentType).toMatch(/^multipart\/form-data; boundary=----ExpoFetchFormBoundary\w{16}$/);
  const boundary = contentType.split('boundary=')[1];
  const body = Buffer.from(normalized.body).toString('latin1');
  expect(body).toContain('--' + boundary + '\r\n');
  expect(body).toContain('name="file"; filename="recording.m4a"\r\ncontent-type: audio/mp4\r\n\r\n');
  expect(body).toContain(Buffer.from(bytes).toString('latin1'));
  expect(body).toContain('name="language"\r\n\r\n' + language + '\r\n');
  expect(body).toContain('name="consent"\r\n\r\ntrue\r\n');
  expect(body.endsWith('--' + boundary + '--\r\n')).toBe(true);
  expect(body).not.toContain(recording.uri);
  expect(body).not.toContain(token);
  expect(f.request.mock.calls[0][1]?.headers).not.toHaveProperty('Content-Type');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['missing', 'size', 'read', 'length', 'type'] as const)('blocks %s local files before the fake HTTP boundary', async failure => {
  if (failure === 'missing') file.exists = false;
  if (failure === 'size') file.size += 1;
  if (failure === 'read') fileBytes.mockRejectedValueOnce(new Error('private file path and token must never escape'));
  if (failure === 'length') fileBytes.mockResolvedValueOnce(bytes.slice(1));
  if (failure === 'type') fileBytes.mockResolvedValueOnce([1, 2] as unknown as typeof bytes);
  const diagnostics: AudioUploadDiagnostic[] = [];
  const f = fixture();
  await expect(f.upload({ onDiagnostic: (event: AudioUploadDiagnostic) => diagnostics.push(event) }))
    .rejects.toMatchObject({ kind: 'validation', mayHaveWritten: false });
  expect(f.wire).not.toHaveBeenCalled();
  expect(diagnostics.at(-1)).toEqual({ stage: 'file-read', outcome: 'failed', kind: 'validation' });
  expect(JSON.stringify(diagnostics)).not.toMatch(/private|file:\/|token|192\.168/);
});

it('preserves bytes and UUID when explicitly retrying after a transport failure', async () => {
  const f = fixture();
  f.request.mockImplementationOnce(async (_url, init) => {
    const normalized = await normalizeBodyInitAsync(init?.body);
    f.wire(normalized);
    throw new Error('private transport error ' + recording.uri + token);
  });
  const diagnostics: AudioUploadDiagnostic[] = [];
  await expect(f.upload({ onDiagnostic: (event: AudioUploadDiagnostic) => diagnostics.push(event) }))
    .rejects.toMatchObject({ kind: 'network', mayHaveWritten: true });
  expect(diagnostics.at(-1)).toEqual({ stage: 'fetch-invoked', outcome: 'failed', kind: 'network' });
  await expect(f.upload()).resolves.toEqual(transcript);
  expect(f.request).toHaveBeenCalledTimes(2);
  for (const [, init] of f.request.mock.calls) expect(init?.headers).toHaveProperty('Idempotency-Key', idempotencyKey);
  for (const [normalized] of f.wire.mock.calls) {
    const body = Buffer.from(normalized.body).toString('latin1');
    expect(body).toContain(Buffer.from(bytes).toString('latin1'));
    expect(body).toContain('filename="recording.m4a"');
    expect(body).not.toContain(recording.uri);
  }
});

it('provides bounded sanitized diagnostics for a successful real SDK body conversion', async () => {
  const f = fixture(); const diagnostic = jest.fn();
  await f.upload({ onDiagnostic: diagnostic });
  expect(diagnostic.mock.calls.map(([event]) => event)).toEqual([
    { stage: 'authentication', outcome: 'progress' },
    { stage: 'fetch-invoked', outcome: 'progress' },
    { stage: 'file-read', outcome: 'progress' },
    { stage: 'fetch-invoked', outcome: 'progress' },
    { stage: 'http-response', outcome: 'progress', status: 200 },
    { stage: 'response-body', outcome: 'progress', status: 200 },
    { stage: 'completed', outcome: 'completed', status: 200 },
  ]);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(token);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(recording.uri);
});

it('does not read bytes or dispatch without a verified access token', async () => {
  const f = fixture(); const diagnostic = jest.fn();
  await expect(f.upload({ getAccessToken: async () => null, onDiagnostic: diagnostic }))
    .rejects.toMatchObject({ kind: 'authentication', mayHaveWritten: false });
  expect(f.request).not.toHaveBeenCalled(); expect(File).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenLastCalledWith({ stage: 'authentication', outcome: 'failed', kind: 'authentication' });
});

it('cannot transmit or publish late diagnostics after a timeout during local byte reading', async () => {
  jest.useFakeTimers(); const f = fixture(); const diagnostic = jest.fn();
  let resolve!: (data: typeof bytes) => void;
  fileBytes.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = f.upload({ timeoutMs: 25, onDiagnostic: diagnostic });
  const checked = expect(pending).rejects.toMatchObject({ kind: 'timeout', mayHaveWritten: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await jest.advanceTimersByTimeAsync(25); await checked;
  const count = diagnostic.mock.calls.length;
  expect(diagnostic).toHaveBeenLastCalledWith({ stage: 'file-read', outcome: 'failed', kind: 'timeout' });
  resolve(bytes);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(f.wire).not.toHaveBeenCalled(); expect(diagnostic).toHaveBeenCalledTimes(count);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not let a throwing diagnostic callback interrupt or repeat an upload', async () => {
  const f = fixture();
  await expect(f.upload({ onDiagnostic: () => { throw new Error(token + recording.uri); } })).resolves.toEqual(transcript);
  expect(f.request).toHaveBeenCalledTimes(1); expect(f.wire).toHaveBeenCalledTimes(1);
});

it.each([
  [503, 'TRANSCRIPTION_DISABLED'], [422, 'INVALID_RECORDING'], [401, 'INVALID_ACCESS_TOKEN'],
  [503, 'PRIVATE_UNRECOGNIZED_CODE'],
] as const)('reports HTTP %s with only an allowlisted matching code %s', async (status, code) => {
  const f = fixture(); const diagnostic = jest.fn();
  f.request.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code, message: token + recording.uri } }),
    { status, headers: { 'Content-Type': 'application/json' } }));
  await expect(f.upload({ onDiagnostic: diagnostic })).rejects.toBeInstanceOf(AudioTranscriptError);
  expect(diagnostic).toHaveBeenLastCalledWith({
    stage: 'response-body', outcome: 'failed', status,
    kind: status === 401 ? 'authentication' : status === 422 ? 'validation' : 'unavailable',
    ...(code !== 'PRIVATE_UNRECOGNIZED_CODE' ? { code } : {}),
  });
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(token);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(recording.uri);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_UNRECOGNIZED_CODE');
});

it.each(['text/html', 'application/json'])('diagnoses an invalid success response without exposing %s content', async contentType => {
  const f = fixture(); const diagnostic = jest.fn();
  f.request.mockResolvedValueOnce(new Response(token + recording.uri, { headers: { 'Content-Type': contentType } }));
  await expect(f.upload({ onDiagnostic: diagnostic })).rejects.toMatchObject({ kind: 'invalid-response', mayHaveWritten: true });
  expect(diagnostic).toHaveBeenLastCalledWith({
    stage: contentType === 'application/json' ? 'response-body' : 'http-response',
    outcome: 'failed', status: 200, kind: 'invalid-response',
  });
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(token);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(recording.uri);
});
