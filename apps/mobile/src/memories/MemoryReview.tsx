import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { listConversationMessages, type ConversationMessage } from '../api/conversation-messages';
import { listMemoryReview, patchMemory, validateMemoryPatchInput, type MemoryFact } from '../api/memory-review';
import { StoryProjectsError, type StoryProjectsErrorKind } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { MemoryReviewScreen, type MemoryReviewState } from './MemoryReviewScreen';

interface Props {
  language: Language;
  title: string;
  ownerId: string;
  projectId: string;
  sessionId: string;
  sessionLanguage: 'en' | 'sv';
  baseUrl: string | null;
  getAccessToken: (expectedOwnerId: string) => Promise<string | null>;
  onBack: () => void;
  onSignOut: () => void;
}
const empty = (phase: MemoryReviewState['phase'], error?: StoryProjectsErrorKind): MemoryReviewState => ({
  phase, memories: [], clarifications: [], sources: [], complete: false, ...(error ? { error } : {}),
});
const privateFailure = (kind: StoryProjectsErrorKind) => ['authentication', 'forbidden', 'not-found'].includes(kind);

/** Source support is not inferred from a correction or an assistant's words. */
export function supportedMemory(memory: MemoryFact, sources: ConversationMessage[]): boolean {
  const source = sources.find(item => item.id === memory.source_message_id);
  return !!source && source.role === 'user' && source.session_id === memory.session_id &&
    source.text.includes(memory.value) && source.text.includes(memory.evidence) &&
    (memory.year === null || memory.evidence.includes(String(memory.year)));
}

/** Scoped RAM only. No optimistic writes, background writes, or automatic PATCH retries. */
export function MemoryReview(props: Props) {
  const identity = [props.ownerId, props.projectId, props.sessionId, props.sessionLanguage, props.baseUrl].join(':');
  return <ScopedMemoryReview key={identity} {...props} />;
}
function ScopedMemoryReview({ language, title, ownerId, projectId, sessionId, sessionLanguage,
  baseUrl, getAccessToken, onBack, onSignOut }: Props) {
  const [state, setState] = useState<MemoryReviewState>(() => empty('loading'));
  const [screenRevision, setScreenRevision] = useState(0);
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; }, [state]);
  const active = useRef(true);
  const alive = useRef(false);
  const busy = useRef(false);
  const blocked = useRef(false);
  const pendingWrite = useRef(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    epoch.current += 1;
    request.current?.abort();
    request.current = null;
    busy.current = false;
  }, []);
  const start = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    const attempt = ++epoch.current;
    request.current = controller;
    const current = () => alive.current && active.current && epoch.current === attempt && !controller.signal.aborted;
    return { controller, current };
  }, []);
  const load = useCallback(async (controller: AbortController): Promise<MemoryReviewState> => {
    if (!baseUrl || readStoryPreviewEnabled()) throw new StoryProjectsError('configuration');
    const options = { baseUrl, projectId, sessionId, expectedLanguage: sessionLanguage,
      getAccessToken: () => getAccessToken(ownerId), signal: controller.signal };
    const review = await listMemoryReview(options);
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    const history = await listConversationMessages(options);
    const complete = review.complete && history.complete;
    if (history.complete && review.memories.some(memory => !supportedMemory(memory, history.messages))) {
      throw new StoryProjectsError('invalid-response');
    }
    return { phase: 'ready', memories: review.memories, clarifications: review.clarifications,
      sources: history.messages, complete };
  }, [baseUrl, projectId, sessionId, sessionLanguage, getAccessToken, ownerId]);
  const refresh = useCallback((notice?: 'conflict' | 'uncertain') => {
    if (!alive.current || !active.current || busy.current || blocked.current) return;
    busy.current = true;
    const { controller, current } = start();
    setState(empty('loading'));
    setScreenRevision(value => value + 1);
    void load(controller).then(result => {
      if (current()) { pendingWrite.current = false; setState({ ...result, ...(notice ? { notice } : {}) }); }
    }).catch(error => {
      if (!current()) return;
      const kind = error instanceof StoryProjectsError ? error.kind : 'network';
      blocked.current = privateFailure(kind);
      setState(empty('error', kind));
    }).finally(() => { if (current()) { busy.current = false; request.current = null; } });
  }, [load, start]);
  useEffect(() => {
    alive.current = true;
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    refresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        active.current = false;
        cancel();
        setState(empty('loading'));
        setScreenRevision(value => value + 1);
      } else if (!active.current) {
        active.current = true;
        refresh(pendingWrite.current ? 'uncertain' : undefined);
      }
    });
    return () => { alive.current = false; cancel(); subscription.remove(); };
  }, [refresh, cancel]);

  const save = (memory: MemoryFact, status: 'confirmed' | 'rejected', correction?: string) => {
    const currentState = latest.current;
    if (!alive.current || !active.current || busy.current || blocked.current ||
      currentState.phase !== 'ready' || !currentState.complete) return;
    const baseline = currentState.memories.find(item => item.id === memory.id && item.version === memory.version);
    if (!baseline || !supportedMemory(baseline, currentState.sources) || !baseUrl || readStoryPreviewEnabled()) return;
    let input;
    try {
      input = validateMemoryPatchInput({ status, expected_version: baseline.version,
        ...(correction !== undefined ? { corrected_value: correction } : {}) });
    } catch { return; }
    busy.current = true;
    pendingWrite.current = true;
    const { controller, current } = start();
    setState({ ...currentState, phase: 'saving' });
    void patchMemory({ baseUrl, projectId, sessionId, expectedLanguage: sessionLanguage,
      getAccessToken: () => getAccessToken(ownerId), signal: controller.signal, memory: baseline, input,
    }).then(async saved => {
      if (!current()) return;
      const result = await load(controller);
      if (!current()) return;
      setScreenRevision(value => value + 1);
      const reloaded = result.memories.find(item => item.id === saved.id);
      if (!reloaded || reloaded.version < saved.version ||
        (reloaded.version === saved.version && (reloaded.status !== saved.status ||
          reloaded.corrected_value !== saved.corrected_value))) throw new StoryProjectsError('invalid-response', undefined, true);
      pendingWrite.current = false;
      setState({ ...result, notice: reloaded.version === saved.version ? 'saved' : 'conflict' });
    }).catch(async error => {
      if (!current()) return;
      const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
      setScreenRevision(value => value + 1);
      if (failure.kind === 'conflict') {
        pendingWrite.current = false;
        setState(empty('loading'));
        try {
          const result = await load(controller);
          if (current()) setState({ ...result, notice: 'conflict' });
        } catch (reloadError) {
          if (!current()) return;
          const kind = reloadError instanceof StoryProjectsError ? reloadError.kind : 'network';
          blocked.current = privateFailure(kind);
          setState(empty('error', kind));
        }
      } else if (privateFailure(failure.kind)) {
        pendingWrite.current = false;
        blocked.current = true;
        setState(empty('error', failure.kind));
      } else {
        pendingWrite.current = failure.mayHaveWritten || ['network', 'timeout', 'invalid-response', 'cancelled'].includes(failure.kind);
        setState({ ...empty(pendingWrite.current ? 'uncertain' : 'error', failure.kind),
          ...(pendingWrite.current ? { notice: 'uncertain' as const } : {}) });
      }
    }).finally(() => { if (current()) { busy.current = false; request.current = null; } });
  };
  const leave = (destination: () => void) => {
    active.current = false;
    cancel();
    setState(empty('loading'));
    setScreenRevision(value => value + 1);
    destination();
  };
  return <MemoryReviewScreen resetRevision={screenRevision} language={language} storyLanguage={sessionLanguage} title={title} state={state}
    onSave={save} onRefresh={() => refresh(pendingWrite.current ? 'uncertain' : undefined)}
    onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
