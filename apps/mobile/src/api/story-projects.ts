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

function validDate(value: unknown): value is string {
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

/** One transport for list/create: no React, native storage, SDK or environment access. */
async function executeStoryRequest<T>({ baseUrl, getAccessToken, signal,
  request = globalThis.fetch, timeoutMs = 10_000 }: ListStoryProjectsOptions,
  input: CreateStoryProjectInput | null, decode: (value: unknown) => T): Promise<T> {
  const creating = input !== null;
  const url = creating ? `${normalizeMobileApiBaseUrl(baseUrl)}/api/v1/story-projects` : storyProjectsUrl(baseUrl);
  if (typeof getAccessToken !== 'function' || typeof request !== 'function' ||
    !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new StoryProjectsError('configuration');
  const controller = new AbortController();
  let dispatched = false;
  const failure = (kind: StoryProjectsErrorKind, status?: number, ambiguous = false) =>
    new StoryProjectsError(kind, status, creating && dispatched && ambiguous);
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
    let token: string | null;
    try { token = await getAccessToken(); } catch { check(); throw new StoryProjectsError('authentication'); }
    check();
    if (typeof token !== 'string' || !token || token.length > 16384 ||
      !/^[A-Za-z0-9._~-]+$/.test(token) || /^sb_(?:publishable|secret)_/.test(token)) throw new StoryProjectsError('authentication');
    let response: Response;
    try {
      dispatched = true;
      response = await request(url, {
        method: creating ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(creating ? { 'Content-Type': 'application/json' } : {}) },
        ...(creating ? { body: JSON.stringify(input) } : {}),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
    } catch { check(); throw failure('network', undefined, true); }
    check();
    if (response.status === 401) throw new StoryProjectsError('authentication', 401);
    if (response.status === 403) throw new StoryProjectsError('forbidden', 403);
    if (response.status === 404) throw new StoryProjectsError('not-found', 404);
    if (response.status === 409) throw new StoryProjectsError('conflict', 409);
    if (response.status === 400 || response.status === 422) throw new StoryProjectsError('validation', response.status);
    if (!response.ok) {
      if (response.status >= 400) throw failure('unavailable', response.status, response.status >= 500);
      throw failure('invalid-response', undefined, true);
    }
    if (response.status !== (creating ? 201 : 200) || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw failure('invalid-response', undefined, true);
    }
    let text: string;
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
      if (creating && dispatched && error.kind === 'invalid-response') throw failure(error.kind, error.status, true);
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

export function listStoryProjects(options: ListStoryProjectsOptions): Promise<StoryProject[]> {
  return executeStoryRequest(options, null, data => {
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
  return executeStoryRequest(options, validated, data => {
    const created = project(data);
    if (created.title !== validated.title || created.language !== validated.language || created.status !== 'draft') {
      throw new StoryProjectsError('invalid-response');
    }
    return created;
  });
}
