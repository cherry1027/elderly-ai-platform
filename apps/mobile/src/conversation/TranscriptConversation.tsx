import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { processTranscript, listConversationMessages, ConversationMessagesError, type ConversationTurn } from '../api/conversation-messages';
import type { AudioTranscript } from '../api/audio-transcripts';
import { StoryProjectsError } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { ConversationPanel, type TranscriptConversationState } from './ConversationPanel';
import { createConversationActionId, useConversationActions, type ConversationAction } from './ConversationActions';

interface Props {
  language: Language;
  ownerId: string;
  projectId: string;
  sessionId: string;
  sessionLanguage: 'en' | 'sv';
  baseUrl: string | null;
  transcripts: AudioTranscript[];
  getAccessToken: (ownerId: string) => Promise<string | null>;
}
const initial: TranscriptConversationState = { phase: 'loading', messages: [], processedIds: [],
  complete: false, canRetry: false, blockedIds: [] };

/** A fresh keyed scope never renders a prior account/session's private history. */
export function TranscriptConversation(props: Props) {
  return <Scope key={[props.ownerId, props.projectId, props.sessionId, props.sessionLanguage].join(':')} {...props} />;
}
function Scope({ language, ownerId, projectId, sessionId, sessionLanguage, baseUrl, transcripts, getAccessToken }: Props) {
  const [state, setState] = useState<TranscriptConversationState>(initial);
  const view = useRef(state);
  const alive = useRef(false);
  const busy = useRef(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const selected = useRef<string | undefined>(undefined);
  const latestTranscripts = useRef(transcripts);
  useLayoutEffect(() => { latestTranscripts.current = transcripts; }, [transcripts]);
  const actions = useConversationActions(ownerId);
  const lastTurn = useRef<ConversationTurn | null>(null);
  const enabled = !!baseUrl && !readStoryPreviewEnabled();
  const prefix = [projectId, sessionId, sessionLanguage, ''].join(':');
  const actionId = (id: string) => prefix + id;
  const knownProcessed = () => [...actions.entries()].filter(([id, action]) =>
    id.startsWith(prefix) && action.status === 'confirmed').map(([, action]) => action.sourceId);
  const knownBlocked = () => [...actions.entries()].filter(([id, action]) =>
    id.startsWith(prefix) && action.status === 'blocked').map(([, action]) => action.sourceId);
  const update = (patch: Partial<TranscriptConversationState>) => {
    view.current = { ...view.current, ...patch };
    if (alive.current) setState(view.current);
  };
  const current = (version: number, controller: AbortController) =>
    alive.current && epoch.current === version && !controller.signal.aborted;
  const failure = (error: unknown) => error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
  const blocked = (error: StoryProjectsError) =>
    ['configuration', 'authentication', 'forbidden', 'not-found', 'validation', 'conflict'].includes(error.kind) &&
    !(error instanceof ConversationMessagesError && error.code === 'CONVERSATION_CHANGED');
  const hideOnAccessFailure = (error: StoryProjectsError) => {
    if (!['authentication', 'forbidden', 'not-found'].includes(error.kind)) return {};
    selected.current = undefined;
    lastTurn.current = null;
    return { messages: [], selectedId: undefined };
  };
  const options = (controller: AbortController) => ({ baseUrl: baseUrl!, sessionId,
    expectedLanguage: sessionLanguage, getAccessToken: () => getAccessToken(ownerId), signal: controller.signal });
  const begin = () => {
    if (!alive.current || !enabled || busy.current) return null;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    return { controller, version: epoch.current };
  };
  const finish = (controller: AbortController) => {
    if (request.current === controller) { busy.current = false; request.current = null; }
  };
  const fetchHistory = async (controller: AbortController, version: number) => {
    const result = await listConversationMessages(options(controller));
    if (!current(version, controller)) return null;
    update({ messages: result.messages, complete: result.complete, processedIds: knownProcessed(), blockedIds: knownBlocked() });
    return result;
  };
  const load = async (reconcile: boolean) => {
    const operation = begin();
    if (!operation) return;
    const { controller, version } = operation;
    update({ phase: reconcile ? 'checking' : 'loading', error: undefined, canRetry: false });
    try {
      const result = await fetchHistory(controller, version);
      if (!result) return;
      const action = selected.current ? actions.get(actionId(selected.current)) : undefined;
      // History has no turn linkage. Source presence/adjacent replies prove nothing.
      // Only a previously verified POST result identifies the linked assistant.
      const confirmed = action?.status === 'confirmed' && result.messages.some(row => row.id === action.assistantId);
      if (action?.status === 'blocked') {
        selected.current = undefined;
        update({ phase: 'ready', selectedId: undefined, error: 'conflict', canRetry: false });
      } else update({ phase: reconcile && action && !confirmed ? 'uncertain' : 'ready',
        canRetry: reconcile && !!action && action.status === 'pending' && result.complete });
    } catch (error) {
      if (current(version, controller)) {
        const safe = failure(error);
        update({ phase: 'error', error: safe.kind, canRetry: false, complete: false, ...hideOnAccessFailure(safe) });
      }
    } finally { finish(controller); }
  };
  useEffect(() => {
    alive.current = true;
    if (enabled) void load(false);
    else update({ phase: 'error', error: 'configuration' });
    const changes = AppState.addEventListener('change', value => {
      if (value === 'active') {
        if (!alive.current) { alive.current = true; void load(false); }
        return;
      }
      alive.current = false;
      epoch.current += 1;
      request.current?.abort();
      request.current = null;
      busy.current = false;
      selected.current = undefined;
      lastTurn.current = null;
      view.current = initial;
      setState(initial);
    });
    return () => {
      alive.current = false;
      epoch.current += 1;
      request.current?.abort();
      lastTurn.current = null;
      changes.remove();
    };
    // Account/session/config identity remounts this scope; token accessor stays current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const select = (id: string) => {
    if (!alive.current || busy.current || view.current.phase !== 'ready') return;
    const source = latestTranscripts.current.find(row => row.transcript_id === id);
    if (!source || source.session_id !== sessionId || source.language !== sessionLanguage || source.status !== 'completed') return;
    selected.current = id;
    const previous = actions.get(actionId(id));
    update({ selectedId: id, phase: previous?.status === 'pending' ? 'uncertain' : previous?.status === 'blocked' ? 'error' : 'ready',
      error: previous?.status === 'blocked' ? 'conflict' : undefined, canRetry: false });
  };
  const submit = async (retry: boolean) => {
    const source = latestTranscripts.current.find(row => row.transcript_id === selected.current);
    if (!source || source.session_id !== sessionId || source.language !== sessionLanguage ||
      source.status !== 'completed' || (retry ? !view.current.canRetry : view.current.phase !== 'ready') ||
      !view.current.complete) return;
    const previous = actions.get(actionId(source.transcript_id));
    if (previous?.status === 'confirmed' || previous?.status === 'blocked' || (!retry && previous) ||
      (previous && (previous.language !== sessionLanguage || previous.sourceId !== source.transcript_id))) return;
    const operation = begin();
    if (!operation) return;
    const { controller, version } = operation;
    let action: ConversationAction | undefined = previous;
    update({ phase: 'checking', error: undefined, canRetry: false });
    try {
      // Fetch before every deliberate POST, including every uncertain replay.
      // This does not cause a write: a separate explicit button initiated submit.
      const history = await fetchHistory(controller, version);
      if (!history) return;
      if (!history.complete) { update({ phase: 'ready' }); return; }
      const original = history.messages.find(row => row.id === source.transcript_id);
      if (!original || original.role !== 'user' || original.text !== source.text) throw new StoryProjectsError('invalid-response');
      if (!action) {
        let key: string;
        try { key = createConversationActionId(); } catch { throw new StoryProjectsError('unavailable'); }
        if (key === source.transcript_id || [...actions.values()].some(item => item.key === key)) throw new StoryProjectsError('unavailable');
        action = { key, sourceId: source.transcript_id, language: sessionLanguage, status: 'pending' };
        actions.set(actionId(source.transcript_id), action);
      }
      update({ phase: 'processing' });
      const turn = await processTranscript({ ...options(controller), projectId,
        sourceTranscript: source, idempotencyKey: action.key });
      if (!current(version, controller)) return;
      const rows = new Map(view.current.messages.map(row => [row.id, row]));
      for (const row of [turn.user_message, turn.message]) {
        const prior = rows.get(row.id);
        if ((prior && JSON.stringify(prior) !== JSON.stringify(row)) ||
            [...rows.values()].some(item => item.id !== row.id && item.sequence === row.sequence)) {
          throw new StoryProjectsError('invalid-response', undefined, true);
        }
        rows.set(row.id, row);
      }
      action.status = 'confirmed';
      action.assistantId = turn.message.id;
      lastTurn.current = turn; // retain the typed candidate/clarification snapshot without review actions
      update({ phase: 'ready', messages: [...rows.values()].sort((a, b) => a.sequence - b.sequence),
        processedIds: knownProcessed(), canRetry: false, error: undefined });
    } catch (error) {
      if (!current(version, controller)) return;
      const safe = failure(error);
      if (action && blocked(safe)) action.status = 'blocked';
      update({ phase: safe.mayHaveWritten ? 'uncertain' : 'error', error: safe.kind, canRetry: false, blockedIds: knownBlocked(), ...hideOnAccessFailure(safe) });
    } finally { finish(controller); }
  };
  return <ConversationPanel language={language} state={state} transcripts={transcripts}
    onSelect={select} onProcess={() => { void submit(false); }} onReconcile={() => { void load(true); }}
    onRetry={() => { void submit(true); }} onRefresh={() => { void load(false); }} />;
}
