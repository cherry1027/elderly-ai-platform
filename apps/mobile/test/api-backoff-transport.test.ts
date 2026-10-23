import { apiBackoff } from '../src/api/backoff';
import { createStoryProject, listStoryProjects, type ListStoryProjectsOptions, StoryProjectsError } from '../src/api/story-projects';
import { AudioTranscriptError, listSessionTranscripts, uploadSessionRecording, SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import { ConversationMessagesError, listConversationMessages, processTranscript } from '../src/api/conversation-messages';
import { listMemoryReview, MemoryReviewError } from '../src/api/memory-review';
import { generateStoryDraft, listStoryDrafts, StoryDraftsError } from '../src/api/story-drafts';
import { listStoryExports, StoryExportsError } from '../src/api/story-exports';

const baseUrl = 'http://192.168.20.40:8000';
const projectId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
const transcriptId = '40000000-0000-4000-8000-000000000001';
const token = 'synthetic.user-access-token.signature';
const privateText = 'private-upstream-message-never-retained';
const expectedLanguage = 'sv' as const;
function response(status: number, code: unknown, retryAfter?: string) {
  return new Response(JSON.stringify({ error: { code, message: privateText } }), {
    status, headers: { 'Content-Type': 'application/json', ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }) },
  });
}
function fixture() {
  const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => response(503, 'API_BUSY', '3'));
  const getAccessToken = jest.fn(async () => token);
  return { request, getAccessToken, options: { baseUrl, request, getAccessToken } };
}
type SafeErrorClass = abstract new (...args: never[]) => StoryProjectsError;
const wrappers: [string, (options: ListStoryProjectsOptions) => Promise<unknown>, SafeErrorClass][] = [
  ['projects', listStoryProjects, StoryProjectsError],
  ['audio', options => listSessionTranscripts({ ...options, sessionId, expectedLanguage }), AudioTranscriptError],
  ['conversation', options => listConversationMessages({ ...options, sessionId, expectedLanguage }), ConversationMessagesError],
  ['memory', options => listMemoryReview({ ...options, projectId, sessionId, expectedLanguage }), MemoryReviewError],
  ['drafts', options => listStoryDrafts({ ...options, projectId, expectedLanguage }), StoryDraftsError],
  ['PDF', options => listStoryExports({ ...options, projectId, expectedLanguage }), StoryExportsError],
];
const writes: [string, (options: ListStoryProjectsOptions) => Promise<unknown>][] = [
  ['create project', options => createStoryProject({ ...options, input: { title: 'Min berättelse', language: 'sv' } })],
  ['generate', options => generateStoryDraft({ ...options, projectId, expectedLanguage, idempotencyKey: key,
    input: { language: 'sv', style: 'warm', confirm_generation: true } })],
  ['process transcript', options => processTranscript({ ...options, projectId, sessionId, expectedLanguage, idempotencyKey: key,
    sourceTranscript: { transcript_id: transcriptId, session_id: sessionId, language: 'sv', status: 'completed',
      text: SIMULATED_TRANSCRIPT_NOTICE + 'Fiktivt exempel.', created_at: '2026-10-23T10:00:00Z' } })],
  ['upload', options => uploadSessionRecording({ ...options, sessionId, expectedLanguage, idempotencyKey: key, consent: true,
    recording: { uri: 'file:///synthetic/recording.m4a', name: 'recording.m4a', type: 'audio/mp4', size: 4000, durationMs: 8000 } })],
];
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
beforeEach(() => { apiBackoff.clear(); jest.useFakeTimers(); jest.setSystemTime(1_000_000); });
afterEach(() => { apiBackoff.clear(); jest.useRealTimers(); });

describe('real shared transport with synthetic admission responses', () => {
  it.each(wrappers)('%s preserves safe advice and its error subclass', async (_name, run, ErrorType) => {
    const f = fixture();
    const error = await run(f.options).catch(value => value);
    expect(error).toBeInstanceOf(ErrorType);
    if (!(error instanceof StoryProjectsError)) throw new Error('Expected a typed safe API error.');
    expect(error).toMatchObject({ kind: 'unavailable', status: 503, mayHaveWritten: false,
      retry: { code: 'API_BUSY', retryAfterSeconds: 3, retryAt: 1_003_000 } });
    expect(JSON.stringify(error)).not.toContain(privateText);
    expect(error.message).not.toContain(privateText);
    expect(apiBackoff.getAdvice(baseUrl)).toBeUndefined(); // Unscoped pure calls never set app cooldown.
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(writes)('%s treats only explicit admission as pre-operation rejection', async (_name, run) => {
    const f = fixture();
    await expect(run(f.options)).rejects.toMatchObject({ mayHaveWritten: false, retry: { code: 'API_BUSY' } });
    f.request.mockResolvedValueOnce(response(429, 'RATE_LIMITED'));
    await expect(run(f.options)).rejects.toMatchObject({ mayHaveWritten: false,
      retry: { code: 'RATE_LIMITED', retryAfterSeconds: 60 } });
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it.each(writes)('%s retains uncertain writes for unknown or plaintext 503', async (_name, run) => {
    const f = fixture();
    f.request.mockResolvedValueOnce(response(503, 'UNKNOWN_ERROR', '2'));
    await expect(run(f.options)).rejects.toMatchObject({ mayHaveWritten: true, retry: undefined });
    f.request.mockResolvedValueOnce(new Response(privateText, { status: 503, headers: { 'Content-Type': 'text/plain', 'Retry-After': '2' } }));
    await expect(run(f.options)).rejects.toMatchObject({ mayHaveWritten: true, retry: undefined });
  });

  it.each([[429, 'API_BUSY'], [503, 'RATE_LIMITED'], [429, 'AUDIO_BUSY'], [503, 'PDF_BUSY'],
    [503, 'SUPABASE_UNAVAILABLE']] as const)('does not reinterpret %s/%s as shared admission', async (status, code) => {
    const f = fixture(); f.request.mockResolvedValueOnce(response(status, code, '7'));
    const error = await createStoryProject({ ...f.options, input: { title: 'A memory', language: 'en' } }).catch(value => value);
    expect(error.retry).toBeUndefined();
    expect(error.mayHaveWritten).toBe(status >= 500);
  });

  it('ignores oversized JSON, malformed JSON and unsafe error code strings', async () => {
    const f = fixture();
    for (const body of [JSON.stringify({ error: { code: 'API_BUSY', message: 'x'.repeat(4097) } }),
      '{invalid JSON', JSON.stringify({ error: { code: 'API_BUSY\nprivate' } })]) {
      f.request.mockResolvedValueOnce(new Response(body, { status: 503, headers: { 'Content-Type': 'application/json' } }));
      await expect(listStoryProjects(f.options)).rejects.toMatchObject({ retry: undefined });
    }
  });

  it('blocks before token acquisition, retains the same deadline and never retries automatically', async () => {
    apiBackoff.activate('synthetic-owner'); const f = fixture();
    await expect(listStoryProjects(f.options)).rejects.toMatchObject({ retry: { retryAt: 1_003_000 } });
    await expect(listStoryProjects(f.options)).rejects.toMatchObject({ retry: { retryAt: 1_003_000 } });
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.getAccessToken).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000); await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(listStoryProjects(f.options)).resolves.toEqual([]);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it.each(wrappers)('%s locally gated requests preserve their wrapper type and advice', async (_name, run, ErrorType) => {
    apiBackoff.activate('synthetic-owner');
    apiBackoff.capture().record(baseUrl, { code: 'RATE_LIMITED', retryAt: 1_060_000, retryAfterSeconds: 60 });
    const f = fixture(); const error = await run(f.options).catch(value => value);
    expect(error).toBeInstanceOf(ErrorType);
    expect(error).toMatchObject({ mayHaveWritten: false, retry: { code: 'RATE_LIMITED', retryAt: 1_060_000 } });
    expect(f.getAccessToken).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });

  it('rechecks admission after asynchronous token acquisition', async () => {
    apiBackoff.activate('synthetic-owner'); const f = fixture();
    let resolveToken!: (value: string) => void;
    f.getAccessToken.mockImplementationOnce(() => new Promise(resolve => { resolveToken = resolve; }));
    const result = listStoryProjects(f.options).catch(value => value);
    apiBackoff.capture().record(baseUrl, { code: 'API_BUSY', retryAt: 1_002_000, retryAfterSeconds: 2 });
    resolveToken(token);
    expect(await result).toMatchObject({ retry: { code: 'API_BUSY' }, mayHaveWritten: false });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('a signed-out late response cannot create a cooldown for the next account', async () => {
    apiBackoff.activate('first-owner'); const f = fixture();
    let resolveResponse!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { resolveResponse = resolve; }));
    const result = listStoryProjects(f.options).catch(value => value); await flush();
    apiBackoff.clear(); apiBackoff.activate('next-owner');
    resolveResponse(response(429, 'RATE_LIMITED', '60'));
    expect(await result).toMatchObject({ kind: 'cancelled' });
    expect(apiBackoff.getAdvice(baseUrl)).toBeUndefined();
  });

  it('a cancelled request cannot set a deadline from a late HTTP response', async () => {
    apiBackoff.activate('synthetic-owner'); const f = fixture(), controller = new AbortController();
    let resolveResponse!: (value: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { resolveResponse = resolve; }));
    const result = listStoryProjects({ ...f.options, signal: controller.signal }).catch(value => value); await flush();
    controller.abort(); expect(await result).toMatchObject({ kind: 'cancelled' });
    resolveResponse(response(503, 'API_BUSY', '30')); await flush();
    expect(apiBackoff.getAdvice(baseUrl)).toBeUndefined();
  });

  it('cancellation while decoding an error body cannot establish a cooldown', async () => {
    apiBackoff.activate('synthetic-owner'); const f = fixture(), controller = new AbortController();
    let resolveBody!: (value: string) => void;
    const pending = response(503, 'API_BUSY', '30');
    pending.text = jest.fn(() => new Promise(resolve => { resolveBody = resolve; }));
    f.request.mockResolvedValueOnce(pending);
    const result = listStoryProjects({ ...f.options, signal: controller.signal }).catch(value => value); await flush();
    controller.abort(); expect(await result).toMatchObject({ kind: 'cancelled' });
    resolveBody(JSON.stringify({ error: { code: 'API_BUSY', message: privateText } })); await flush();
    expect(apiBackoff.getAdvice(baseUrl)).toBeUndefined();
  });

  it('an unreadable admission body remains an uncertain write without advice', async () => {
    const f = fixture(), pending = response(503, 'API_BUSY', '30');
    pending.text = jest.fn(async () => { throw new Error(privateText); });
    f.request.mockResolvedValueOnce(pending);
    const error = await createStoryProject({ ...f.options, input: { title: 'A memory', language: 'en' } }).catch(value => value);
    expect(error).toMatchObject({ kind: 'unavailable', mayHaveWritten: true, retry: undefined });
    expect(JSON.stringify(error)).not.toContain(privateText);
  });
});
