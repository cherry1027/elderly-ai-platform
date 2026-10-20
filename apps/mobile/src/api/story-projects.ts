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
  'validation' | 'unavailable' | 'network' | 'timeout' | 'invalid-response' | 'cancelled';

const messages: Record<StoryProjectsErrorKind, string> = {
  configuration: 'The development project service is not configured.',
  authentication: 'Please sign in again to load your projects.',
  forbidden: 'Access to these projects is not permitted.',
  'not-found': 'The project service could not be found.',
  validation: 'The project request could not be accepted.',
  unavailable: 'The development project service is unavailable. Please try again later.',
  network: 'The development project service could not be reached.',
  timeout: 'The project request took too long. Please try again.',
  'invalid-response': 'The project service returned an unexpected response.',
  cancelled: 'The project request was cancelled.',
};

export class StoryProjectsError extends Error {
  constructor(readonly kind: StoryProjectsErrorKind, readonly status?: number) {
    super(messages[kind]);
    this.name = 'StoryProjectsError';
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

/** No React, native storage, Supabase SDK or environment access. All failures are sanitized. */
export async function listStoryProjects({ baseUrl, getAccessToken, signal,
  request = globalThis.fetch, timeoutMs = 10_000 }: ListStoryProjectsOptions): Promise<StoryProject[]> {
  const url = storyProjectsUrl(baseUrl);
  if (typeof getAccessToken !== 'function' || typeof request !== 'function' ||
    !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new StoryProjectsError('configuration');
  const controller = new AbortController();
  let interruption: 'cancelled' | 'timeout' | null = null;
  let finished = false;
  let rejectInterrupted: (error: StoryProjectsError) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (finished || interruption) return;
    interruption = reason;
    controller.abort();
    rejectInterrupted(new StoryProjectsError(reason));
  };
  const check = () => { if (interruption) throw new StoryProjectsError(interruption); };
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
      response = await request(url, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
    } catch { check(); throw new StoryProjectsError('network'); }
    check();
    if (response.status === 401) throw new StoryProjectsError('authentication', 401);
    if (response.status === 403) throw new StoryProjectsError('forbidden', 403);
    if (response.status === 404) throw new StoryProjectsError('not-found', 404);
    if (response.status === 400 || response.status === 422) throw new StoryProjectsError('validation', response.status);
    if (!response.ok) throw new StoryProjectsError('unavailable', response.status);
    if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new StoryProjectsError('invalid-response');
    }
    let text: string;
    try { text = await response.text(); } catch { check(); throw new StoryProjectsError('network'); }
    check();
    if (text.length > 1_048_576) throw new StoryProjectsError('invalid-response');
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new StoryProjectsError('invalid-response'); }
    if (!Array.isArray(data) || data.length > 50) throw new StoryProjectsError('invalid-response');
    const rows = data.map(project);
    if (new Set(rows.map(row => row.id.toLowerCase())).size !== rows.length) throw new StoryProjectsError('invalid-response');
    check();
    return rows;
  })();
  try {
    return await Promise.race([operation, interrupted]);
  } catch (error) {
    if (error instanceof StoryProjectsError) throw error;
    throw new StoryProjectsError('invalid-response');
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
