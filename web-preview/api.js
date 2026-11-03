const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^\/api\/v[12]\/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9_=&%-]+)?$/;
const KINDS = new Set(['transcription', 'conversation', 'generation', 'speech']);
const OPERATION_FIELDS = ['operation_id', 'kind', 'status', 'project_id', 'session_id', 'created_at', 'updated_at', 'error_code', 'result'];
const awareTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
// These responses occur before execute() claims a paid operation. A matching
// operation header always wins, including failures raised later by the same
// shared helpers inside execute(). Unknown conflicts/server failures stay held.
const NO_DISPATCH = new Map([
  ['NO_CONFIRMED_MEMORIES', 409], ['CLARIFICATION_REQUIRED', 409],
  ['SESSION_COMPLETED', 409], ['AI_CONTEXT_LIMIT', 409],
  ['LIVE_AI_DISABLED', 503], ['REAL_AI_NOT_CONFIGURED', 503],
  ['AI_SPENDING_NOT_APPROVED', 503], ['AI_USAGE_UNAVAILABLE', 503],
  ['TEXT_CHAT_NOT_READY', 503],
]);

async function textDigest(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function validOriginalText(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return false;
  const points = [...value];
  return points.length <= 4000 && points.every(point => point.length !== 1 || point.charCodeAt(0) < 0xd800 || point.charCodeAt(0) > 0xdfff);
}
function typedMemoriesMatch(memories, original, scope) {
  if (!Array.isArray(memories) || memories.length > 8) return false;
  const seen = new Set();
  return memories.every(memory => {
    if (!memory || !UUID.test(memory.id || '') || seen.has(memory.id) ||
        memory.project_id !== scope.projectId || memory.session_id !== scope.sessionId || memory.source_message_id !== original.id ||
        memory.status !== 'pending' || memory.version !== 1 || memory.corrected_value !== null ||
        !['person', 'relationship', 'date', 'location', 'event', 'emotion'].includes(memory.fact_type) ||
        typeof memory.uncertain !== 'boolean' || !awareTimestamp(memory.created_at) || !awareTimestamp(memory.updated_at) ||
        typeof memory.value !== 'string' || !memory.value.trim() || [...memory.value].length > 1000 || !original.text.includes(memory.value) ||
        typeof memory.evidence !== 'string' || !memory.evidence.trim() || [...memory.evidence].length > 1000 || !original.text.includes(memory.evidence)) return false;
    seen.add(memory.id); return true;
  });
}

async function resultMatchesAction(result, action) {
  const scoped = action.kind === 'conversation' ? result?.message : result;
  if (!scoped || typeof scoped !== 'object') return false;
  if (action.scope) {
    if (action.kind !== 'speech' && (scoped.project_id !== action.scope.projectId ||
        (action.scope.sessionId && scoped.session_id !== action.scope.sessionId))) return false;
    if (action.scope.language && scoped.language !== action.scope.language) return false;
  }
  if (action.typedInput) {
    const original = result.user_message, reply = result.message;
    if (result.mode !== 'real' || !original || !reply || original.role !== 'user' || reply.role !== 'assistant' ||
        !UUID.test(original.source_text_input_id || '') || original.id !== original.source_text_input_id ||
        original.source_text_input_id !== reply.source_text_input_id ||
        original.source_transcript_id !== null || reply.source_transcript_id !== null ||
        original.project_id !== action.scope?.projectId || original.session_id !== action.scope?.sessionId ||
        original.language !== action.scope?.language || !UUID.test(reply.id || '') || reply.id === original.id ||
        !awareTimestamp(original.created_at) || !awareTimestamp(reply.created_at) ||
        !Number.isSafeInteger(original.sequence) || original.sequence < 1 || reply.sequence !== original.sequence + 1 ||
        original.provenance?.mode !== 'original' || original.provenance?.provider !== 'user' ||
        original.provenance?.model !== null || original.provenance?.version !== 1 ||
        reply.provenance?.mode !== 'real' || reply.provenance?.provider !== 'openai' || reply.provenance?.version !== 1 ||
        typeof reply.provenance?.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(reply.provenance.model) ||
        !validOriginalText(original.text) || typeof reply.text !== 'string' || !reply.text.trim() ||
        !typedMemoriesMatch(result.memories, original, action.scope)) return false;
    return await textDigest(original.text) === action.textDigest;
  }
  return action.kind !== 'speech' || result.assistant_message_id === action.assistantMessageId;
}

function verifiedFailedOperation(op, action) {
  // Only the owned server operation's terminal failed state proves that this
  // operation stopped before provider dispatch. An error code alone does not.
  if (!op || typeof op !== 'object' || Array.isArray(op) ||
      Object.keys(op).length !== OPERATION_FIELDS.length || OPERATION_FIELDS.some(field => !Object.hasOwn(op, field)) ||
      !UUID.test(op.operation_id || '') || (action.operationId && op.operation_id !== action.operationId) ||
      op.kind !== action.kind || op.status !== 'failed' || op.result !== null ||
      !action.scope || !UUID.test(action.scope.projectId || '') || op.project_id !== action.scope.projectId ||
      !awareTimestamp(op.created_at) || !awareTimestamp(op.updated_at) ||
      typeof op.error_code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(op.error_code)) return false;
  const expectedSession = action.kind === 'generation' ? null : action.scope.sessionId;
  return expectedSession === null ? op.session_id === null :
    UUID.test(expectedSession || '') && op.session_id === expectedSession;
}

export class AppError extends Error {
  constructor(message, code = 'REQUEST_FAILED', uncertain = false) {
    super(message); this.name = 'AppError'; this.code = code; this.uncertain = uncertain;
  }
}

export function validatePath(path) {
  if (typeof path !== 'string' || path.length > 500 || !PATH.test(path) || path.includes('//') || path.includes('..')) {
    throw new AppError('This action is unavailable.', 'INVALID_PATH');
  }
  return path;
}

function messageFor(code, status) {
  if (status === 401) return 'Please sign in again. Your private content has been cleared.';
  if (status === 403 || status === 404) return 'This saved item is unavailable for your account.';
  if (code === 'AI_USAGE_LIMIT' || code === 'AI_SPENDING_NOT_APPROVED') return 'The local AI testing allowance has closed or reached its limit. This is separate from your OpenAI account balance. Your saved work and PDF export remain available.';
  if (code === 'AI_PROVIDER_QUOTA_EXHAUSTED') return 'The AI provider rejected the request because of its credit or billing limit. This is separate from the local Memy testing allowance. Your saved work is still available.';
  if (code === 'LIVE_AI_DISABLED' || code === 'REAL_AI_NOT_CONFIGURED') return 'Real AI is currently switched off. Your saved work is still available.';
  if (code === 'TEXT_CHAT_NOT_READY') return 'Typed conversation is waiting for its development database setup. Your message has not been sent to AI. Keep it here and try again after setup is complete.';
  if (code === 'NO_CONFIRMED_MEMORIES') return 'Review and confirm your memories before creating an autobiography.';
  if (code === 'CLARIFICATION_REQUIRED') return 'Resolve the open memory questions before creating your autobiography.';
  if (code === 'SPEECH_EXPIRED') return 'This spoken reply expired. Request another only when you choose to.';
  if (status === 409) return 'This item has changed or the action is still being checked. Refresh your saved work.';
  if (status === 429) return 'Please wait a moment before the next action.';
  if ([400, 413, 415, 422].includes(status)) return 'Please check the input or recording format and try again.';
  return 'Memy could not finish this request. Your saved work has not been replaced.';
}

export function createApi(auth, { request = fetch, timeoutMs = 145000, makeId = () => crypto.randomUUID() } = {}) {
  let disposed = false, epoch = 0, pending = null;
  const controllers = new Set();
  async function call(method, path, options = {}) {
    validatePath(path);
    if (!['GET', 'POST', 'PATCH'].includes(method)) throw new AppError('This action is unavailable.');
    const version = epoch;
    if (disposed) throw new AppError('This view is closed.', 'CANCELLED');
    const token = await auth.getAccessToken();
    if (disposed || version !== epoch) throw new AppError('This view is closed.', 'CANCELLED');
    if (!token) throw new AppError('Please sign in again.', 'AUTH_REQUIRED');
    const controller = new AbortController(); controllers.add(controller);
    let dispatched = false;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: options.binary === 'pdf' ? 'application/pdf' : options.binary === 'wav' ? 'audio/wav' : 'application/json' };
      if (options.key) {
        if (!UUID.test(options.key)) throw new AppError('This action is unavailable.');
        headers['Idempotency-Key'] = options.key;
      }
      if (options.json !== undefined) headers['Content-Type'] = 'application/json';
      dispatched = true;
      const response = await request(path, { method, headers,
        ...(options.form ? { body: options.form } : options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (disposed || version !== epoch) throw new AppError('This view is closed.', 'CANCELLED', Boolean(options.key));
      if (!response.ok) {
        let code = 'REQUEST_FAILED';
        try { const value = await response.json(); if (/^[A-Z0-9_]{1,80}$/.test(value?.error?.code)) code = value.error.code; } catch { /* No raw server error is shown. */ }
        const operationId = response.headers.get('X-Memy-Operation-Id');
        const noDispatch = !operationId && NO_DISPATCH.get(code) === response.status;
        const uncertain = Boolean(options.key) && (Boolean(operationId) ||
          (!noDispatch && (response.status >= 500 || response.status === 409)));
        const message = code === 'TEXT_CHAT_NOT_READY' && operationId
          ? 'Typed conversation setup could not be confirmed. Check your saved action before sending again. Nothing will be retried automatically.'
          : messageFor(code, response.status);
        const error = new AppError(message, code, uncertain);
        error.status = response.status;
        if (UUID.test(operationId || '')) error.operationId = operationId;
        if (response.status === 401) auth.invalidate();
        throw error;
      }
      if (options.binary) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const expected = options.binary === 'pdf' ? 'application/pdf' : 'audio/wav';
        const max = options.binary === 'pdf' ? 2000000 : 10000000;
        if (!bytes.length || bytes.length > max || response.headers.get('Content-Type')?.split(';')[0] !== expected ||
            !response.headers.get('Cache-Control')?.includes('no-store')) throw new AppError('The saved file could not be verified.', 'INVALID_RESPONSE');
        if (disposed || version !== epoch) { bytes.fill(0); throw new AppError('This view is closed.', 'CANCELLED'); }
        return { bytes, headers: response.headers };
      }
      const raw = await response.text();
      if (raw.length > 2000000 || disposed || version !== epoch) throw new AppError('The response could not be verified.', 'INVALID_RESPONSE');
      return JSON.parse(raw);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(options.key && dispatched ? 'The result is not confirmed yet. Check the saved action before doing it again.' : 'The connection was interrupted. Please refresh your saved work.',
        'NETWORK_UNCERTAIN', Boolean(options.key && dispatched));
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }

  return {
    call,
    hasPending: () => pending !== null,
    pendingSummary: () => pending ? { kind: pending.kind, operationId: pending.operationId } : null,
    async paid(kind, path, options = {}) {
      if (!KINDS.has(kind) || pending) throw new AppError('Check the previously saved action before starting another.', 'ACTION_PENDING', true);
      const key = makeId(); if (!UUID.test(key)) throw new AppError('A secure action could not be created.');
      const typedInput = kind === 'conversation' && /^\/api\/v2\/story-sessions\/[0-9a-f-]+\/text-messages$/i.test(path);
      const action = { kind, key, scope: options.scope ? { ...options.scope } : null, operationId: null, typedInput,
        assistantMessageId: kind === 'speech' ? path.split('/')[4] : null }; pending = action;
      try {
        if (typedInput) {
          const original = options.json?.text;
          if (!validOriginalText(original) ||
              !UUID.test(action.scope?.projectId || '') || !UUID.test(action.scope?.sessionId || '') ||
              path.split('/')[4] !== action.scope.sessionId || options.json.language !== action.scope.language || !['en', 'sv'].includes(action.scope.language)) {
            throw new AppError('Write a message between 1 and 4,000 characters.', 'INVALID_INPUT');
          }
          // Only the digest is retained in the pending action, never private words.
          // Claiming pending before this await also blocks simultaneous clicks.
          action.textDigest = await textDigest(original);
          if (pending !== action || disposed) throw new AppError('This view is closed.', 'CANCELLED');
        }
        const result = await call('POST', path, { ...options, key });
        if (pending !== action || disposed) throw new AppError('This view is closed.', 'CANCELLED', true);
        if (!await resultMatchesAction(result, action)) {
          throw new AppError('The saved result could not be verified. Check the saved action before continuing.', 'INVALID_RESPONSE', true);
        }
        if (pending !== action || disposed) throw new AppError('This view is closed.', 'CANCELLED', true);
        pending = null; return result;
      } catch (error) {
        if (error.operationId) action.operationId = error.operationId;
        // Even invalid/lost paid responses require an owned operation lookup;
        // no automatic POST retry or silent replacement action is permitted.
        if (!error.uncertain && !disposed) pending = null;
        throw error;
      }
    },
    async reconcile() {
      if (!pending) throw new AppError('There is no action awaiting a saved result.');
      const action = pending, version = epoch;
      const op = await call('GET', `/api/v2/operations/by-key/${action.kind}/${action.key}`);
      if (pending !== action || disposed || epoch !== version) throw new AppError('This view is closed.', 'CANCELLED', true);
      if (!op || typeof op !== 'object' || op.kind !== action.kind) throw new AppError('The saved result could not be verified.', 'INVALID_RESPONSE', true);
      if (action.scope && (op.project_id !== action.scope.projectId || (action.scope.sessionId && op.session_id !== action.scope.sessionId))) throw new AppError('The saved result could not be verified.', 'INVALID_RESPONSE', true);
      if (op.status === 'failed') {
        if (!verifiedFailedOperation(op, action)) throw new AppError('The saved result could not be verified.', 'INVALID_RESPONSE', true);
        pending = null;
        throw new AppError('The server confirmed this action stopped before sending an AI request. Nothing was retried. Check AI availability before choosing to try again.', 'ACTION_NOT_PROCESSED', false);
      }
      if (op.status !== 'completed' || !op.result) throw new AppError('This action is still being checked. Refresh again later; it has not been resent.', 'ACTION_PENDING', true);
      if (action.typedInput && (Object.keys(op).length !== OPERATION_FIELDS.length || OPERATION_FIELDS.some(field => !Object.hasOwn(op, field)) ||
          !UUID.test(op.operation_id || '') || (action.operationId && op.operation_id !== action.operationId) ||
          op.result.user_message?.source_text_input_id !== op.operation_id || op.error_code !== null ||
          !awareTimestamp(op.created_at) || !awareTimestamp(op.updated_at))) throw new AppError('The saved result could not be verified.', 'INVALID_RESPONSE', true);
      if (!await resultMatchesAction(op.result, action)) throw new AppError('The saved result could not be verified.', 'INVALID_RESPONSE', true);
      if (pending !== action || disposed || epoch !== version) throw new AppError('This view is closed.', 'CANCELLED', true);
      pending = null; return op.result;
    },
    dispose() { disposed = true; epoch++; controllers.forEach(c => c.abort()); controllers.clear(); },
  };
}
