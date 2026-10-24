import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { AppState } from 'react-native';
import { listConversationMessages, type ConversationMessage } from '../api/conversation-messages';
import { listMemoryReview, patchMemory, validateMemoryPatchInput, type MemoryFact, type MemoryPatchInput } from '../api/memory-review';
import { StoryProjectsError, type StoryProjectsErrorKind } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { MemoryReviewScreen, type MemoryReviewState, type MemoryReviewDraft } from './MemoryReviewScreen';
import type { LeaveHandle } from '../navigation/useGuardedLeave';

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
  backLabel?: string;
  onSignOut: () => void;
  leaveRef?: Ref<LeaveHandle>;
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
interface PendingReview {
  memory: MemoryFact;
  input: MemoryPatchInput;
  draft: MemoryReviewDraft;
  acknowledged?: MemoryFact;
  uncertain: boolean;
  conflict: boolean;
}
function sameSource(a: MemoryFact, b: MemoryFact): boolean {
  return a.id === b.id && a.project_id === b.project_id && a.session_id === b.session_id &&
    a.source_message_id === b.source_message_id && a.fact_type === b.fact_type && a.value === b.value &&
    a.evidence === b.evidence && a.year === b.year && a.slot === b.slot && a.uncertain === b.uncertain &&
    a.created_at === b.created_at;
}
function sameReview(a: MemoryFact, b: MemoryFact): boolean {
  return sameSource(a, b) && a.version === b.version && a.status === b.status &&
    a.corrected_value === b.corrected_value;
}
function retained(attempt: PendingReview, canRetry = false): NonNullable<MemoryReviewState['retainedReview']> {
  return { ...attempt.draft, memory: attempt.memory, expectedVersion: attempt.input.expected_version,
    canRetry, conflict: attempt.conflict };
}
function ScopedMemoryReview({ language, title, ownerId, projectId, sessionId, sessionLanguage,
  baseUrl, getAccessToken, onBack, onSignOut, backLabel, leaveRef }: Props) {
  const [state, setState] = useState<MemoryReviewState>(() => empty('loading'));
  const [screenRevision, setScreenRevision] = useState(0);
  const latest = useRef(state);
  const publish = useCallback((value: MemoryReviewState) => { latest.current = value; setState(value); }, []);
  const active = useRef(true), alive = useRef(false), busy = useRef(false), blocked = useRef(false);
  // Private draft/payload live only inside this owner/project/session scope.
  const pending = useRef<PendingReview | null>(null);
  const captured = useRef<MemoryReviewDraft | null>(null);
  // Only this non-content flag survives background privacy cleanup.
  const pendingWrite = useRef(false);
  const epoch = useRef(0), request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    epoch.current++; request.current?.abort(); request.current = null; busy.current = false;
  }, []);
  const clearDraft = useCallback(() => { pending.current = null; captured.current = null; }, []);
  const start = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController(), attempt = ++epoch.current;
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
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    if (history.complete && review.memories.some(memory => !supportedMemory(memory, history.messages))) {
      throw new StoryProjectsError('invalid-response');
    }
    return { phase: 'ready', memories: review.memories, clarifications: review.clarifications,
      sources: history.messages, complete: review.complete && history.complete };
  }, [baseUrl, projectId, sessionId, sessionLanguage, getAccessToken, ownerId]);

  const fail = useCallback((error: unknown) => {
    const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network');
    if (privateFailure(failure.kind)) {
      blocked.current = true; pendingWrite.current = false; clearDraft();
      publish(empty('error', failure.kind));
      return;
    }
    const attempt = pending.current;
    if (attempt) {
      publish({ ...latest.current, phase: attempt.uncertain ? 'uncertain' : 'error', error: failure.kind,
        retainedReview: retained(attempt), notice: attempt.uncertain ? 'uncertain' : 'retained' });
    } else publish(empty('error', failure.kind));
  }, [clearDraft, publish]);

  // Reads can resolve a known acknowledgment, but never silently rebase an old
  // correction onto another version or infer this write from a latest record.
  const reconcile = useCallback((result: MemoryReviewState, attempt: PendingReview) => {
    if (pending.current !== attempt) return;
    if (!result.complete) {
      publish({ ...result, retainedReview: retained(attempt),
        notice: attempt.uncertain ? 'uncertain' : 'retained' });
      return;
    }
    const actual = result.memories.find(memory => memory.id === attempt.memory.id);
    if (attempt.acknowledged && actual && actual.version < attempt.acknowledged.version) {
      throw new StoryProjectsError('invalid-response', undefined, true);
    }
    if (attempt.acknowledged && actual && sameReview(actual, attempt.acknowledged)) {
      pendingWrite.current = false; clearDraft(); setScreenRevision(value => value + 1);
      publish({ ...result, notice: 'saved' });
      return;
    }
    if (attempt.conflict || attempt.acknowledged || !actual || !sameReview(actual, attempt.memory)) {
      attempt.conflict = true;
      publish({ ...result, retainedReview: retained(attempt), notice: 'conflict' });
      return;
    }
    publish({ ...result, retainedReview: retained(attempt, true),
      notice: attempt.uncertain ? 'uncertain' : 'retained' });
  }, [clearDraft, publish]);

  const refresh = useCallback((notice?: 'uncertain') => {
    if (!alive.current || !active.current || busy.current || blocked.current) return;
    busy.current = true;
    const { controller, current } = start();
    const attempt = pending.current;
    if (attempt) publish({ ...latest.current, phase: 'loading', error: undefined, retainedReview: retained(attempt) });
    else { publish(empty('loading')); setScreenRevision(value => value + 1); }
    void load(controller).then(result => {
      if (!current()) return;
      if (attempt) reconcile(result, attempt);
      else { pendingWrite.current = false; publish({ ...result, ...(notice ? { notice } : {}) }); }
    }).catch(error => { if (current()) fail(error); })
      .finally(() => { if (current()) { busy.current = false; request.current = null; } });
  }, [load, start, reconcile, publish, fail]);

  useEffect(() => {
    alive.current = true;
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    refresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        active.current = false; cancel(); clearDraft();
        publish(empty('loading')); setScreenRevision(value => value + 1);
      } else if (!active.current) {
        active.current = true; refresh(pendingWrite.current ? 'uncertain' : undefined);
      }
    });
    return () => { alive.current = false; cancel(); clearDraft(); subscription.remove(); };
  }, [refresh, cancel, clearDraft, publish]);

  const send = async (attempt: PendingReview, op: ReturnType<typeof start>) => {
    pendingWrite.current = true;
    try {
      const saved = await patchMemory({ baseUrl: baseUrl!, projectId, sessionId, expectedLanguage: sessionLanguage,
        getAccessToken: () => getAccessToken(ownerId), signal: op.controller.signal,
        memory: attempt.memory, input: attempt.input });
      if (!op.current()) return;
      attempt.acknowledged = Object.freeze({ ...saved }); attempt.uncertain = true;
      const result = await load(op.controller);
      if (op.current()) reconcile(result, attempt);
    } catch (error) {
      if (!op.current()) return;
      const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
      attempt.uncertain = attempt.uncertain || !!attempt.acknowledged || failure.mayHaveWritten ||
        ['network', 'timeout', 'invalid-response', 'cancelled'].includes(failure.kind);
      pendingWrite.current = attempt.uncertain;
      if (failure.kind === 'conflict') {
        attempt.conflict = true;
        // Existing 409 recovery stays read-only; a backoff here must retain intent.
        try {
          const result = await load(op.controller);
          if (op.current()) reconcile(result, attempt);
        } catch (readError) { if (op.current()) fail(readError); }
      } else fail(failure);
    }
  };

  const save = (memory: MemoryFact, status: 'confirmed' | 'rejected', correction?: string) => {
    const shown = latest.current, form = captured.current;
    captured.current = null;
    if (!alive.current || !active.current || busy.current || blocked.current || shown.phase !== 'ready' ||
      !shown.complete || !baseUrl || readStoryPreviewEnabled()) return;
    let attempt = pending.current;
    const retrying = !!attempt;
    if (attempt) {
      if (attempt.memory.id !== memory.id || !shown.retainedReview?.canRetry || attempt.conflict || attempt.acknowledged) return;
    } else {
      const baseline = shown.memories.find(item => item.id === memory.id && item.version === memory.version);
      if (!baseline || !supportedMemory(baseline, shown.sources)) return;
      let input: MemoryPatchInput;
      try { input = validateMemoryPatchInput({ status, expected_version: baseline.version,
        ...(correction !== undefined ? { corrected_value: correction } : {}) }); }
      catch { return; }
      const draft: MemoryReviewDraft = form && form.memoryId === baseline.id && form.expectedVersion === baseline.version
        ? { ...form } : { memoryId: baseline.id, expectedVersion: baseline.version,
          action: status === 'rejected' ? 'reject' : correction === undefined ? 'confirm' : 'correct',
          correction: correction ?? '' };
      attempt = { memory: Object.freeze({ ...baseline }), input: Object.freeze({ ...input }),
        draft: Object.freeze(draft), uncertain: false, conflict: false };
      pending.current = attempt;
    }
    busy.current = true;
    const op = start(), selected = attempt;
    publish({ ...shown, phase: 'saving', error: undefined, retainedReview: retained(selected) });
    void (async () => {
      if (retrying) {
        const result = await load(op.controller);
        if (!op.current()) return;
        reconcile(result, selected);
        if (!latest.current.retainedReview?.canRetry || pending.current !== selected) return;
        publish({ ...latest.current, phase: 'saving', retainedReview: retained(selected), error: undefined });
      }
      await send(selected, op);
    })().catch(error => { if (op.current()) fail(error); })
      .finally(() => { if (op.current()) { busy.current = false; request.current = null; } });
  };

  const reviewLatest = () => {
    const attempt = pending.current, shown = latest.current;
    if (!attempt?.conflict || shown.phase !== 'ready' || shown.error || !shown.complete ||
      busy.current || blocked.current || !alive.current || !active.current) return;
    if (!shown.memories.some(memory => memory.id === attempt.memory.id)) return;
    // A deliberate re-review discards the old mutation; no version is rebased or
    // PATCH sent here. The person must choose a fresh action against current data.
    pendingWrite.current = false; clearDraft(); setScreenRevision(value => value + 1);
    publish({ ...shown, phase: 'ready', retainedReview: undefined, error: undefined, notice: 'conflict' });
  };
  const leave = (destination: () => void) => {
    active.current = false; cancel(); clearDraft(); pendingWrite.current = false;
    publish(empty('loading')); setScreenRevision(value => value + 1); destination();
  };
  return <MemoryReviewScreen resetRevision={screenRevision} language={language} storyLanguage={sessionLanguage} title={title} state={state}
    onCaptureReview={draft => { captured.current = Object.freeze({ ...draft }); }}
    onSave={save} onRefresh={() => refresh(pendingWrite.current ? 'uncertain' : undefined)} onReviewLatest={reviewLatest}
    backLabel={backLabel} leaveRef={leaveRef} onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
