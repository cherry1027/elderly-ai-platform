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
  constructor(readonly kind: StoryProjectsErrorKind, readonly status?: number, readonly mayHaveCreated = false) {
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

interface StoryRequest {
  method: 'GET' | 'POST' | 'PATCH';
  projectId?: string;
  input?: CreateStoryProjectInput | UpdateStoryProjectInput | Record<string, never>;
  child?: 'continue' | 'sessions';
  expectedStatus?: 200;
  audio?: { sessionId: string; action: 'transcribe' | 'transcripts'; body?: FormData;
    idempotencyKey?: string; onHttpError: (status: number, code?: string) => StoryProjectsError;
    onProgress?: (stage: 'authentication' | 'fetch-invoked' | 'http-response' | 'response-body', status?: number) => void };
}

/** One transport for project and session actions, without SDK or native storage. */
async function executeStoryRequest<T>({ baseUrl, getAccessToken, signal,
  request = globalThis.fetch, timeoutMs = 10_000 }: ListStoryProjectsOptions,
  endpoint: StoryRequest, decode: (value: unknown) => T): Promise<T> {
  const writing = endpoint.method !== 'GET';
  const resource = `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-projects`;
  const url = endpoint.audio ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-sessions/${endpoint.audio.sessionId}/${endpoint.audio.action}${endpoint.audio.action === 'transcripts' ? '?limit=50&offset=0' : ''}`
    : endpoint.projectId ? `${resource}/${endpoint.projectId}${endpoint.child
    ? `/${endpoint.child}${endpoint.child === 'sessions' ? '?limit=50&offset=0' : ''}` : ''}`
    : writing ? resource : storyProjectsUrl(baseUrl);
  if (typeof getAccessToken !== 'function' || typeof request !== 'function' ||
    !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new StoryProjectsError('configuration');
  const controller = new AbortController();
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
  const check = () => { if (interruption) throw failure(interruption, undefined, true); };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  const operation = (async () => {
    check();
    progress('authentication');
    let token: string | null;
    try { token = await getAccessToken(); } catch { check(); throw new StoryProjectsError('authentication'); }
    check();
    if (typeof token !== 'string' || !token || token.length > 16384 ||
      !/^[A-Za-z0-9._~-]+$/.test(token) || /^sb_(?:publishable|secret)_/.test(token)) throw new StoryProjectsError('authentication');
    let response: Response;
    try {
      dispatched = true;
      progress('fetch-invoked');
      response = await request(url, {
        method: endpoint.method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
          ...(writing && !endpoint.audio ? { 'Content-Type': 'application/json' } : {}),
          ...(endpoint.audio?.idempotencyKey ? { 'Idempotency-Key': endpoint.audio.idempotencyKey } : {}) },
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
    if (!response.ok && endpoint.audio) {
      // Audio may interpret only an allowlisted code. Metadata errors continue
      // to ignore upstream bodies, including human-readable private messages.
      let code: string | undefined;
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json') {
        try {
          progress('response-body', response.status);
          const text = await response.text();
          check();
          if (text.length <= 4096) {
            const error = JSON.parse(text)?.error;
            if (error && typeof error.code === 'string') code = error.code;
          }
        } catch { check(); }
      }
      check();
      throw endpoint.audio.onHttpError(response.status, code);
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
    if (response.status !== (endpoint.expectedStatus ?? (endpoint.method === 'POST' ? 201 : 200)) || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw failure('invalid-response', undefined, true);
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
