import { apiBackoff, BackoffScopeError, BackoffWaitError, parseRetryAdvice, type RetryAdvice } from './backoff';

export interface StoryProject {
  id: string;
  title: string;
  description: string | null;
  language: 'en' | 'sv';
  status: string;
  created_at: string;
  updated_at: string;
}

export type StoryProjectsErrorKind = 'configuration' | 'authentication' | 'forbidden' | 'not-found' |
  'validation' | 'conflict' | 'unavailable' | 'network' | 'timeout' | 'invalid-response' | 'cancelled';

const messages: Record<StoryProjectsErrorKind, string> = {
  configuration: 'The development project service is not configured.',
  authentication: 'Please sign in again to load your projects.',
  forbidden: 'Access to these projects is not permitted.',
  'not-found': 'The project service could not be found.',
  validation: 'The project request could not be accepted.',
  conflict: 'The project request conflicts with existing data.',
  unavailable: 'The development project service is unavailable. Please try again later.',
  network: 'The development project service could not be reached.',
  timeout: 'The project request took too long. Please try again.',
  'invalid-response': 'The project service returned an unexpected response.',
  cancelled: 'The project request was cancelled.',
};

export class StoryProjectsError extends Error {
  constructor(readonly kind: StoryProjectsErrorKind, readonly status?: number, readonly mayHaveCreated = false,
    readonly retry?: RetryAdvice) {
    super(messages[kind]);
    this.name = 'StoryProjectsError';
  }
  // Preserve the earlier constructor/property while also describing uncertain
  // PATCH outcomes. Neither flag is evidence that a server write succeeded.
  get mayHaveWritten(): boolean { return this.mayHaveCreated; }
}

export interface CreateStoryProjectInput { title: string; language: 'en' | 'sv' }

export class CreateStoryInputError extends Error {
  constructor(readonly kind: 'required' | 'too-long' | 'language') {
    super(kind === 'required' ? 'Enter a story title.' : kind === 'too-long'
      ? 'Use a title with no more than 120 characters.' : 'Choose English or Swedish.');
    this.name = 'CreateStoryInputError';
  }
}

/** Trim boundary whitespace; preserve internal text and count Unicode code points. */
export function validateCreateStoryInput(value: unknown): CreateStoryProjectInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'language,title') throw new CreateStoryInputError('required');
    const { title: rawTitle, language } = value as Record<string, unknown>;
    if (typeof rawTitle !== 'string') throw new CreateStoryInputError('required');
    // Include Python str.strip() whitespace omitted by JavaScript trim().
    const title = rawTitle.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/gu, '');
    // Probe only: never strip internal joiners, accents or emoji from the payload.
    // Format/control/mark-only text and blank fillers do not provide a title.
    if (!/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{M}\u2800]/u.test(title)) {
      throw new CreateStoryInputError('required');
    }
    if (title.length > 240 || [...title].length > 120) throw new CreateStoryInputError('too-long');
    if (language !== 'en' && language !== 'sv') throw new CreateStoryInputError('language');
    return { title, language };
  } catch (error) {
    if (error instanceof CreateStoryInputError) throw error;
    throw new CreateStoryInputError('required');
  }
}

export interface UpdateStoryProjectInput { title?: string; description?: string | null }

export class UpdateStoryInputError extends Error {
  constructor(readonly kind: 'description' | 'payload') {
    super(kind === 'description' ? 'Use a description with no more than 4,000 characters.'
      : 'Provide only a title or description to update.');
    this.name = 'UpdateStoryInputError';
  }
}

/** Omitted values stay omitted; explicit null clears only the description. */
export function validateUpdateStoryInput(value: unknown): UpdateStoryProjectInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UpdateStoryInputError('payload');
    const keys = Object.keys(value);
    if (!keys.length || keys.some(key => key !== 'title' && key !== 'description')) throw new UpdateStoryInputError('payload');
    const input = value as Record<string, unknown>;
    const result: UpdateStoryProjectInput = {};
    if (Object.hasOwn(input, 'title')) result.title = validateCreateStoryInput({ title: input.title, language: 'en' }).title;
    if (Object.hasOwn(input, 'description')) {
      const description = input.description;
      if (description !== null && (typeof description !== 'string' || description.length > 8000 || [...description].length > 4000)) {
        throw new UpdateStoryInputError('description');
      }
      result.description = description;
    }
    return result;
  } catch (error) {
    if (error instanceof CreateStoryInputError || error instanceof UpdateStoryInputError) throw error;
    throw new UpdateStoryInputError('payload');
  }
}

export function validateStoryProjectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new StoryProjectsError('validation');
  }
  return value.toLowerCase();
}

/** Explicit development LAN origins only; never DNS, loopback, public or alternate IP spellings. */
export function normalizeMobileApiBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) throw new StoryProjectsError('configuration');
  const match = /^(https?):\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::([1-9]\d{0,4}))?(\/(?:api\/v1\/?)?)?$/.exec(value);
  if (!match || /\s/.test(value)) throw new StoryProjectsError('configuration');
  const segments = match[2].split('.');
  const octets = segments.map(Number);
  if (octets.some((octet, index) => octet > 255 || String(octet) !== segments[index]) ||
    !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)) ||
    (match[3] && Number(match[3]) > 65535)) throw new StoryProjectsError('configuration');
  const port = match[3] && !((match[1] === 'http' && match[3] === '80') || (match[1] === 'https' && match[3] === '443'))
    ? `:${match[3]}` : '';
  return `${match[1]}://${match[2]}${port}`;
}

/** The API prefix appears exactly once; only the first read-only page is requested. */
export function storyProjectsUrl(baseUrl: string): string {
  return `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-projects?limit=50&offset=0`;
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59;
}

function project(value: unknown): StoryProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoryProjectsError('invalid-response');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) ||
    typeof row.title !== 'string' || !(row.description === null || typeof row.description === 'string') ||
    (row.language !== 'en' && row.language !== 'sv') || typeof row.status !== 'string' ||
    !validDate(row.created_at) || !validDate(row.updated_at)) throw new StoryProjectsError('invalid-response');
  return { id: row.id, title: row.title, description: row.description, language: row.language,
    status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}

export interface ListStoryProjectsOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  signal?: AbortSignal;
  request?: typeof fetch;
  timeoutMs?: number;
}

type MemoryReviewRequest = {
  method: 'GET'; sessionId: string; action: 'memories' | 'clarifications'; limit: number; offset: number;
  onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError;
} | {
  method: 'PATCH'; memoryId: string;
  input: { status: 'confirmed' | 'rejected'; expected_version: number; corrected_value?: string };
  onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError;
};

export type StoryDraftRequest = {
  action: 'list' | 'read' | 'verification' | 'generate' | 'edit' | 'history';
  projectId: string; draftId?: string; idempotencyKey?: string;
  input?: { language: 'en' | 'sv'; style: 'warm'; confirm_generation: true } |
    { content: string; expected_revision: number };
  limit?: number; offset?: number;
  onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError;
};

export interface StoryPdfResponse {
  bytes: Uint8Array;
  headers: Record<string, string | null>;
}
export type StoryExportRequest = {
  action: 'create' | 'list' | 'download'; projectId: string;
  draftId?: string; exportId?: string; limit?: number; offset?: number;
  onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError;
};

interface StoryRequest {
  method: 'GET' | 'POST' | 'PATCH';
  projectId?: string;
  input?: CreateStoryProjectInput | UpdateStoryProjectInput | Record<string, never> |
    { source_message_id: string; language: 'en' | 'sv' } |
    { status: 'confirmed' | 'rejected'; expected_version: number; corrected_value?: string } |
    { language: 'en' | 'sv'; style: 'warm'; confirm_generation: true } |
    { content: string; expected_revision: number } |
    { format: 'pdf'; include_title_page: true; include_page_numbers: true };
  child?: 'continue' | 'sessions';
  memoryReview?: MemoryReviewRequest;
  draft?: StoryDraftRequest;
  pdf?: StoryExportRequest;
  conversation?: { sessionId: string; method: 'GET' | 'POST'; idempotencyKey?: string;
    limit?: number; offset?: number; input?: { source_message_id: string; language: 'en' | 'sv' };
    onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError };
  expectedStatus?: 200 | 201;
  audio?: { sessionId: string; action: 'transcribe' | 'transcripts'; body?: FormData;
    idempotencyKey?: string; onHttpError: (status: number, code?: string, retry?: RetryAdvice) => StoryProjectsError;
    onProgress?: (stage: 'authentication' | 'fetch-invoked' | 'http-response' | 'response-body', status?: number) => void };
}

/** One transport for project and session actions, without SDK or native storage. */
async function executeStoryRequest<T>({ baseUrl, getAccessToken, signal,
  request = globalThis.fetch, timeoutMs = 10_000 }: ListStoryProjectsOptions,
  endpoint: StoryRequest, decode: (value: unknown) => T): Promise<T> {
  const writing = endpoint.method !== 'GET';
  const origin = normalizeMobileApiBaseUrl(baseUrl);
  const resource = `${origin}/api/v1/story-projects`;
  const url = endpoint.pdf ? (endpoint.pdf.action === 'create'
    ? normalizeMobileApiBaseUrl(baseUrl) + '/api/v1/story-drafts/' + endpoint.pdf.draftId + '/export'
    : endpoint.pdf.action === 'download'
      ? normalizeMobileApiBaseUrl(baseUrl) + '/api/v1/story-exports/' + endpoint.pdf.exportId + '/download'
      : resource + '/' + endpoint.pdf.projectId + '/exports?limit=' + endpoint.pdf.limit + '&offset=' + endpoint.pdf.offset)
    : endpoint.draft ? (['read', 'edit', 'history'].includes(endpoint.draft.action)
    ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-drafts/${endpoint.draft.draftId}${endpoint.draft.action === 'history'
      ? `/history?limit=${endpoint.draft.limit}&offset=${endpoint.draft.offset}` : ''}`
    : `${resource}/${endpoint.draft.projectId}/${endpoint.draft.action === 'list'
      ? `drafts?limit=${endpoint.draft.limit ?? 1}&offset=${endpoint.draft.offset ?? 0}` : endpoint.draft.action}`)
    : endpoint.memoryReview ? (endpoint.memoryReview.method === 'PATCH'
    ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/memories/${endpoint.memoryReview.memoryId}`
    : `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-sessions/${endpoint.memoryReview.sessionId}/${endpoint.memoryReview.action}?limit=${endpoint.memoryReview.limit}&offset=${endpoint.memoryReview.offset}`)
    : endpoint.conversation ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-sessions/${endpoint.conversation.sessionId}/messages${endpoint.conversation.method === 'GET' ? `?limit=${endpoint.conversation.limit}&offset=${endpoint.conversation.offset}` : ''}`
    : endpoint.audio ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-sessions/${endpoint.audio.sessionId}/${endpoint.audio.action}${endpoint.audio.action === 'transcripts' ? '?limit=50&offset=0' : ''}`
    : endpoint.projectId ? `${resource}/${endpoint.projectId}${endpoint.child
    ? `/${endpoint.child}${endpoint.child === 'sessions' ? '?limit=50&offset=0' : ''}` : ''}`
    : writing ? resource : storyProjectsUrl(baseUrl);
  if (typeof getAccessToken !== 'function' || typeof request !== 'function' ||
    !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new StoryProjectsError('configuration');
  const controller = new AbortController();
  const lease = apiBackoff.capture();
  const onHttpError = endpoint.pdf?.onHttpError ?? endpoint.audio?.onHttpError ?? endpoint.conversation?.onHttpError ??
    endpoint.memoryReview?.onHttpError ?? endpoint.draft?.onHttpError;
  const admissionError = (retry: RetryAdvice) => {
    const status = retry.code === 'RATE_LIMITED' ? 429 : 503;
    return onHttpError ? onHttpError(status, retry.code, retry) : new StoryProjectsError('unavailable', status, false, retry);
  };
  let dispatched = false;
  const progress = (stage: 'authentication' | 'fetch-invoked' | 'http-response' | 'response-body', status?: number) => {
    try { endpoint.audio?.onProgress?.(stage, status); } catch { /* diagnostics cannot affect requests */ }
  };
  const failure = (kind: StoryProjectsErrorKind, status?: number, ambiguous = false) =>
    new StoryProjectsError(kind, status, writing && dispatched && ambiguous);
  let interruption: 'cancelled' | 'timeout' | null = null;
  let finished = false;
  let rejectInterrupted: (error: StoryProjectsError) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (finished || interruption) return;
    interruption = reason;
    controller.abort();
    rejectInterrupted(failure(reason, undefined, true));
  };
  const check = () => {
    if (interruption) throw failure(interruption, undefined, true);
    if (!lease.isCurrent()) throw failure('cancelled', undefined, true);
  };
  const checkAdmission = () => {
    try { lease.assertReady(origin); } catch (error) {
      if (error instanceof BackoffWaitError) throw admissionError(error.advice);
      if (error instanceof BackoffScopeError) throw failure('cancelled');
      throw error;
    }
  };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  const operation = (async () => {
    check();
    checkAdmission();
    progress('authentication');
    let token: string | null;
    try { token = await getAccessToken(); } catch { check(); throw new StoryProjectsError('authentication'); }
    check();
    checkAdmission();
    if (typeof token !== 'string' || !token || token.length > 16384 ||
      !/^[A-Za-z0-9._~-]+$/.test(token) || /^sb_(?:publishable|secret)_/.test(token)) throw new StoryProjectsError('authentication');
    let response: Response;
    try {
      dispatched = true;
      progress('fetch-invoked');
      response = await request(url, {
        method: endpoint.method,
        headers: { Authorization: `Bearer ${token}`, Accept: endpoint.pdf && endpoint.pdf.action !== 'list' ? 'application/pdf' : 'application/json',
          ...(writing && !endpoint.audio ? { 'Content-Type': 'application/json' } : {}),
          ...(endpoint.audio?.idempotencyKey || endpoint.conversation?.idempotencyKey || endpoint.draft?.idempotencyKey
            ? { 'Idempotency-Key': endpoint.audio?.idempotencyKey ?? endpoint.conversation?.idempotencyKey ?? endpoint.draft!.idempotencyKey! } : {}) },
        ...(writing ? { body: endpoint.audio?.body ?? JSON.stringify(endpoint.input) } : {}),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
    } catch (error) {
      check();
      // A validated local audio-file read can fail during Expo's body conversion,
      // before HTTP starts. Preserve its safe classification, never native text.
      if (endpoint.audio && error instanceof StoryProjectsError) throw error;
      throw failure('network', undefined, true);
    }
    check();
    progress('http-response', response.status);
    if (!response.ok && (onHttpError || response.status === 429 || response.status === 503)) {
      // Only fixed status/code pairs affect admission. Never retain upstream
      // messages, request bodies or unbounded error-code strings.
      let code: string | undefined;
      const length = response.headers?.get('content-length');
      if ((!length || (/^[0-9]+$/.test(length) && Number(length) <= 4096)) &&
        response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json') {
        try {
          progress('response-body', response.status);
          const text = await response.text();
          check();
          if (text.length <= 4096) {
            const error = JSON.parse(text)?.error;
            if (error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) code = error.code;
          }
        } catch { check(); }
      }
      check();
      const retry = parseRetryAdvice(response.status, code, response.headers?.get('retry-after') ?? null);
      if (retry) {
        lease.record(origin, retry);
        throw admissionError(retry);
      }
      if (onHttpError) throw onHttpError(response.status, code);
    }
    if (response.status === 401) throw new StoryProjectsError('authentication', 401);
    if (response.status === 403) throw new StoryProjectsError('forbidden', 403);
    if (response.status === 404) throw new StoryProjectsError('not-found', 404);
    if (response.status === 409) throw new StoryProjectsError('conflict', 409);
    if (response.status === 400 || response.status === 422) throw new StoryProjectsError('validation', response.status);
    if (!response.ok) {
      if (response.status >= 400) throw failure('unavailable', response.status, response.status >= 500);
      throw failure('invalid-response', undefined, true);
    }
    const binary = !!endpoint.pdf && endpoint.pdf.action !== 'list';
    if (response.status !== (endpoint.expectedStatus ?? (endpoint.method === 'POST' ? 201 : 200)) ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== (binary ? 'application/pdf' : 'application/json')) {
      throw failure('invalid-response', undefined, true);
    }
    if (binary) {
      // Native fetch buffers response bodies. Bound declared length before reading,
      // then check actual bytes; no document is passed to storage before decoding.
      const length = response.headers.get('content-length');
      if (!length || !/^[1-9][0-9]{0,6}$/.test(length) || Number(length) < 20 || Number(length) > 2_000_000) {
        throw failure('invalid-response', undefined, true);
      }
      const headers: Record<string, string | null> = {};
      for (const name of ['content-disposition', 'cache-control', 'pragma', 'expires', 'x-content-type-options',
        'x-memy-export-id', 'x-memy-draft-version', 'x-memy-draft-revision', 'x-memy-page-count']) {
        headers[name] = response.headers.get(name);
      }
      let buffer: ArrayBuffer;
      try { buffer = await response.arrayBuffer(); } catch { check(); throw failure('network', undefined, true); }
      check();
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength !== Number(length) || bytes.byteLength > 2_000_000) {
        throw failure('invalid-response', undefined, true);
      }
      const result = decode({ bytes, headers } satisfies StoryPdfResponse);
      check(); return result;
    }
    let text: string;
    progress('response-body', response.status);
    try { text = await response.text(); } catch { check(); throw failure('network', undefined, true); }
    check();
    if (text.length > 1_048_576) throw failure('invalid-response', undefined, true);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw failure('invalid-response', undefined, true); }
    const result = decode(data);
    check();
    return result;
  })();
  try {
    return await Promise.race([operation, interrupted]);
  } catch (error) {
    if (error instanceof StoryProjectsError) {
      if (writing && dispatched && error.kind === 'invalid-response') throw failure(error.kind, error.status, true);
      throw error;
    }
    throw failure('invalid-response', undefined, true);
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

/** Only fixed, validated session-audio paths enter the shared transport. */
export function executeSessionAudioRequest<T>(options: ListStoryProjectsOptions,
  endpoint: NonNullable<StoryRequest['audio']>, decode: (value: unknown) => T): Promise<T> {
  const sessionId = validateStoryProjectId(endpoint.sessionId);
  if ((endpoint.action !== 'transcribe' && endpoint.action !== 'transcripts') ||
    typeof endpoint.onHttpError !== 'function' ||
    (endpoint.action === 'transcribe' && (!endpoint.body || typeof endpoint.idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(endpoint.idempotencyKey))) ||
    (endpoint.action === 'transcripts' && (endpoint.body !== undefined || endpoint.idempotencyKey !== undefined))) {
    throw new StoryProjectsError('validation');
  }
  return executeStoryRequest(options, { method: endpoint.action === 'transcribe' ? 'POST' : 'GET',
    expectedStatus: 200, audio: { ...endpoint, sessionId } }, decode);
}

/** Fixed JSON session-message paths share the existing auth/cancellation transport. */
export function executeSessionConversationRequest<T>(options: ListStoryProjectsOptions,
  endpoint: NonNullable<StoryRequest['conversation']>, decode: (value: unknown) => T): Promise<T> {
  const sessionId = validateStoryProjectId(endpoint.sessionId);
  if (typeof endpoint.onHttpError !== 'function' || (endpoint.method !== 'GET' && endpoint.method !== 'POST')) {
    throw new StoryProjectsError('validation');
  }
  if (endpoint.method === 'GET') {
    if (!Number.isSafeInteger(endpoint.limit) || endpoint.limit! < 1 || endpoint.limit! > 100 ||
      !Number.isSafeInteger(endpoint.offset) || endpoint.offset! < 0 || endpoint.offset! > 100_000 ||
      endpoint.input !== undefined || endpoint.idempotencyKey !== undefined) throw new StoryProjectsError('validation');
  } else {
    if (typeof endpoint.idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(endpoint.idempotencyKey) ||
      !endpoint.input || Object.keys(endpoint.input).sort().join(',') !== 'language,source_message_id' ||
      (endpoint.input.language !== 'en' && endpoint.input.language !== 'sv') ||
      validateStoryProjectId(endpoint.input.source_message_id) !== endpoint.input.source_message_id) {
      throw new StoryProjectsError('validation');
    }
  }
  return executeStoryRequest(options, { method: endpoint.method, expectedStatus: endpoint.method === 'POST' ? 201 : 200,
    ...(endpoint.method === 'POST' ? { input: endpoint.input } : {}), conversation: { ...endpoint, sessionId } }, decode);
}

/** Fixed memory-review JSON resources use the same verified-user transport. */
export function executeMemoryReviewRequest<T>(options: ListStoryProjectsOptions,
  endpoint: MemoryReviewRequest, decode: (value: unknown) => T): Promise<T> {
  if (typeof endpoint.onHttpError !== 'function') throw new StoryProjectsError('validation');
  if (endpoint.method === 'GET') {
    const sessionId = validateStoryProjectId(endpoint.sessionId);
    if ((endpoint.action !== 'memories' && endpoint.action !== 'clarifications') ||
      !Number.isSafeInteger(endpoint.limit) || endpoint.limit < 1 || endpoint.limit > 100 ||
      !Number.isSafeInteger(endpoint.offset) || endpoint.offset < 0 || endpoint.offset > 100_000) {
      throw new StoryProjectsError('validation');
    }
    return executeStoryRequest(options, { method: 'GET', expectedStatus: 200, memoryReview: { ...endpoint, sessionId } }, decode);
  }
  if (endpoint.method !== 'PATCH') throw new StoryProjectsError('validation');
  const memoryId = validateStoryProjectId(endpoint.memoryId);
  return executeStoryRequest(options, { method: 'PATCH', expectedStatus: 200, input: endpoint.input,
    memoryReview: { ...endpoint, memoryId } }, decode);
}

/** Fixed draft resources only; generation never retries in the transport. */
export function executeStoryDraftRequest<T>(options: ListStoryProjectsOptions,
  endpoint: StoryDraftRequest, decode: (value: unknown) => T): Promise<T> {
  const projectId = validateStoryProjectId(endpoint.projectId);
  if (!['list', 'read', 'verification', 'generate', 'edit', 'history'].includes(endpoint.action) ||
    typeof endpoint.onHttpError !== 'function') throw new StoryProjectsError('validation');
  const writing = endpoint.action === 'generate' || endpoint.action === 'edit';
  let draftId: string | undefined;
  if (['read', 'edit', 'history'].includes(endpoint.action)) draftId = validateStoryProjectId(endpoint.draftId);
  else if (endpoint.draftId !== undefined) throw new StoryProjectsError('validation');
  if (endpoint.action === 'generate') {
    validateStoryProjectId(endpoint.idempotencyKey);
    if (!endpoint.input || Object.keys(endpoint.input).sort().join(',') !== 'confirm_generation,language,style' ||
      !('language' in endpoint.input) ||
      (endpoint.input.language !== 'en' && endpoint.input.language !== 'sv') ||
      endpoint.input.style !== 'warm' || endpoint.input.confirm_generation !== true) throw new StoryProjectsError('validation');
  } else if (endpoint.action === 'edit') {
    if (endpoint.idempotencyKey !== undefined || !endpoint.input ||
      Object.keys(endpoint.input).sort().join(',') !== 'content,expected_revision' || !('content' in endpoint.input) ||
      typeof endpoint.input.content !== 'string' || !Number.isSafeInteger(endpoint.input.expected_revision) ||
      endpoint.input.expected_revision < 1) throw new StoryProjectsError('validation');
  } else if (endpoint.input !== undefined || endpoint.idempotencyKey !== undefined) throw new StoryProjectsError('validation');
  if (endpoint.action === 'history' || (endpoint.action === 'list' &&
    (endpoint.limit !== undefined || endpoint.offset !== undefined))) {
    if (!Number.isSafeInteger(endpoint.limit) || endpoint.limit! < 1 || endpoint.limit! > 100 ||
      !Number.isSafeInteger(endpoint.offset) || endpoint.offset! < 0 || endpoint.offset! > 100_000) {
      throw new StoryProjectsError('validation');
    }
  } else if (endpoint.limit !== undefined || endpoint.offset !== undefined) throw new StoryProjectsError('validation');
  return executeStoryRequest(options, { method: endpoint.action === 'edit' ? 'PATCH' : writing ? 'POST' : 'GET',
    expectedStatus: endpoint.action === 'generate' ? 201 : 200,
    ...(writing ? { input: endpoint.input } : {}), draft: { ...endpoint, projectId, draftId } }, decode);
}

/** PDF endpoints share auth, bounded cancellation and safe error decoding. */
export function executeStoryExportRequest<T>(options: ListStoryProjectsOptions,
  endpoint: StoryExportRequest, decode: (value: unknown) => T): Promise<T> {
  const projectId = validateStoryProjectId(endpoint.projectId);
  if (!['create', 'list', 'download'].includes(endpoint.action) || typeof endpoint.onHttpError !== 'function') {
    throw new StoryProjectsError('validation');
  }
  if (endpoint.action === 'create') {
    const draftId = validateStoryProjectId(endpoint.draftId);
    if (endpoint.exportId !== undefined || endpoint.limit !== undefined || endpoint.offset !== undefined) {
      throw new StoryProjectsError('validation');
    }
    return executeStoryRequest(options, { method: 'POST', expectedStatus: 201,
      input: { format: 'pdf', include_title_page: true, include_page_numbers: true },
      pdf: { ...endpoint, projectId, draftId } }, decode);
  }
  if (endpoint.action === 'download') {
    const exportId = validateStoryProjectId(endpoint.exportId);
    if (endpoint.draftId !== undefined || endpoint.limit !== undefined || endpoint.offset !== undefined) {
      throw new StoryProjectsError('validation');
    }
    return executeStoryRequest(options, { method: 'GET', expectedStatus: 200, pdf: { ...endpoint, projectId, exportId } }, decode);
  }
  if (endpoint.draftId !== undefined || endpoint.exportId !== undefined ||
    !Number.isSafeInteger(endpoint.limit) || endpoint.limit! < 1 || endpoint.limit! > 100 ||
    !Number.isSafeInteger(endpoint.offset) || endpoint.offset! < 0 || endpoint.offset! > 100_000) {
    throw new StoryProjectsError('validation');
  }
  return executeStoryRequest(options, { method: 'GET', expectedStatus: 200, pdf: { ...endpoint, projectId } }, decode);
}

export function listStoryProjects(options: ListStoryProjectsOptions): Promise<StoryProject[]> {
  return executeStoryRequest(options, { method: 'GET' }, data => {
    if (!Array.isArray(data) || data.length > 50) throw new StoryProjectsError('invalid-response');
    const rows = data.map(project);
    if (new Set(rows.map(row => row.id.toLowerCase())).size !== rows.length) throw new StoryProjectsError('invalid-response');
    return rows;
  });
}

export interface CreateStoryProjectOptions extends ListStoryProjectsOptions { input: CreateStoryProjectInput }

/** No retries: an interrupted/malformed write can have succeeded on the server. */
export async function createStoryProject({ input, ...options }: CreateStoryProjectOptions): Promise<StoryProject> {
  const validated = validateCreateStoryInput(input);
  return executeStoryRequest(options, { method: 'POST', input: validated }, data => {
    const created = project(data);
    if (created.title !== validated.title || created.language !== validated.language || created.status !== 'draft') {
      throw new StoryProjectsError('invalid-response');
    }
    return created;
  });
}

export interface GetStoryProjectOptions extends ListStoryProjectsOptions { projectId: string }

export async function getStoryProject({ projectId, ...options }: GetStoryProjectOptions): Promise<StoryProject> {
  const id = validateStoryProjectId(projectId);
  return executeStoryRequest(options, { method: 'GET', projectId: id }, data => {
    const loaded = project(data);
    if (loaded.id.toLowerCase() !== id) throw new StoryProjectsError('invalid-response');
    return loaded;
  });
}

export interface UpdateStoryProjectOptions extends GetStoryProjectOptions {
  input: UpdateStoryProjectInput;
  expectedLanguage: 'en' | 'sv';
}

/** A lost response may hide a committed update; callers must reconcile before retrying. */
export async function updateStoryProject({ projectId, input, expectedLanguage, ...options }: UpdateStoryProjectOptions): Promise<StoryProject> {
  const id = validateStoryProjectId(projectId);
  const validated = validateUpdateStoryInput(input);
  if (expectedLanguage !== 'en' && expectedLanguage !== 'sv') throw new StoryProjectsError('validation');
  return executeStoryRequest(options, { method: 'PATCH', projectId: id, input: validated }, data => {
    const updated = project(data);
    if (updated.id.toLowerCase() !== id || updated.language !== expectedLanguage ||
      (Object.hasOwn(validated, 'title') && updated.title !== validated.title) ||
      (Object.hasOwn(validated, 'description') && updated.description !== validated.description)) {
      throw new StoryProjectsError('invalid-response');
    }
    return updated;
  });
}

export interface ConversationSession {
  id: string;
  project_id: string;
  language: 'en' | 'sv';
  status: 'active' | 'completed';
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

/** Selected saved-draft metadata only; this feature never exposes draft prose or source memories. */
export interface ContinuedDraftMetadata {
  draft_id: string;
  project_id: string;
  language: 'en' | 'sv';
  status: 'ready_for_review' | 'edited';
  version: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface StoryContinuation {
  project_id: string;
  language: 'en' | 'sv';
  session: ConversationSession;
  session_created: boolean;
  latest_draft: ContinuedDraftMetadata | null;
  generation_triggered: false;
}

export interface StorySessionOptions extends GetStoryProjectOptions { expectedLanguage: 'en' | 'sv' }

function responseUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function conversationSession(value: unknown, projectId: string, language: 'en' | 'sv'): ConversationSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoryProjectsError('invalid-response');
  const row = value as Record<string, unknown>;
  if (!responseUuid(row.id) || !responseUuid(row.project_id) || row.project_id.toLowerCase() !== projectId ||
    row.language !== language || (row.status !== 'active' && row.status !== 'completed') ||
    !validDate(row.created_at) || !validDate(row.updated_at) || !(row.ended_at === null || validDate(row.ended_at)) ||
    (row.status === 'active' && row.ended_at !== null)) {
    throw new StoryProjectsError('invalid-response');
  }
  return { id: row.id.toLowerCase(), project_id: projectId, language, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at, ended_at: row.ended_at };
}

function continuedDraftMetadata(value: unknown, projectId: string, language: 'en' | 'sv'): ContinuedDraftMetadata | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoryProjectsError('invalid-response');
  const row = value as Record<string, unknown>;
  if (!responseUuid(row.draft_id) || !responseUuid(row.project_id) || row.project_id.toLowerCase() !== projectId ||
    row.language !== language || (row.status !== 'ready_for_review' && row.status !== 'edited') ||
    row.style !== 'warm' || row.mode !== 'mock' ||
    !Number.isSafeInteger(row.version) || (row.version as number) < 1 ||
    !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 ||
    !validDate(row.created_at) || !validDate(row.updated_at)) throw new StoryProjectsError('invalid-response');
  // The full backend draft contains prose, source memories and a verification report.
  // They are deliberately neither retained nor interpreted by this session landing feature.
  return { draft_id: row.draft_id.toLowerCase(), project_id: projectId, language, status: row.status,
    version: row.version as number, revision: row.revision as number,
    created_at: row.created_at, updated_at: row.updated_at };
}

function sessionRequestIdentity(projectId: unknown, expectedLanguage: unknown): { id: string; language: 'en' | 'sv' } {
  const id = validateStoryProjectId(projectId);
  if (expectedLanguage !== 'en' && expectedLanguage !== 'sv') throw new StoryProjectsError('validation');
  return { id, language: expectedLanguage };
}

/** Atomic backend start/resume; no direct session-creation POST and no automatic retries. */
export async function continueStoryProject({ projectId, expectedLanguage, ...options }: StorySessionOptions): Promise<StoryContinuation> {
  const { id, language } = sessionRequestIdentity(projectId, expectedLanguage);
  return executeStoryRequest(options, { method: 'POST', projectId: id, child: 'continue', input: {}, expectedStatus: 200 }, data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoryProjectsError('invalid-response');
    const row = data as Record<string, unknown>;
    if (!responseUuid(row.project_id) || row.project_id.toLowerCase() !== id || row.language !== language ||
      typeof row.session_created !== 'boolean' || row.generation_triggered !== false) throw new StoryProjectsError('invalid-response');
    const session = conversationSession(row.session, id, language);
    if (session.status !== 'active') throw new StoryProjectsError('invalid-response');
    return { project_id: id, language, session, session_created: row.session_created,
      latest_draft: continuedDraftMetadata(row.latest_draft, id, language), generation_triggered: false };
  });
}

/** Read-only reconciliation after an uncertain continuation; backend order is newest first. */
export async function listStorySessions({ projectId, expectedLanguage, ...options }: StorySessionOptions): Promise<ConversationSession[]> {
  const { id, language } = sessionRequestIdentity(projectId, expectedLanguage);
  return executeStoryRequest(options, { method: 'GET', projectId: id, child: 'sessions' }, data => {
    if (!Array.isArray(data) || data.length > 50) throw new StoryProjectsError('invalid-response');
    const rows = data.map(value => conversationSession(value, id, language));
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new StoryProjectsError('invalid-response');
    return rows;
  });
}
