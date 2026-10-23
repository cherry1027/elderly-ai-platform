import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler } from 'react-native';
import { editStoryDraft, getStoryDraft, listDraftHistory, sameDraftOriginal, validateDraftEditInput,
  type DraftEditInput, type StoryDraft, type StoryEdit } from '../api/story-drafts';
import { StoryProjectsError } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { DraftEditorScreen, type DraftEditingState } from './DraftEditorScreen';
import { DraftHistoryScreen, type DraftHistoryState } from './DraftHistoryScreen';
import { draftEditingCopy } from './draft-editing-copy';

export interface DraftEditingProps {
  mode: 'edit' | 'history'; language: Language; storyLanguage: Language; title: string;
  ownerId: string; projectId: string; draftId: string; baseUrl: string | null;
  getAccessToken: (owner: string) => Promise<string | null>;
  onBack: () => void; onSignOut: () => void;
}
const safeError = (error: unknown) => error instanceof StoryProjectsError ? error : new StoryProjectsError('network');
const accessFailure = (error: StoryProjectsError) => ['authentication', 'forbidden', 'not-found'].includes(error.kind);
const emptyEditor = (): DraftEditingState => ({ phase: 'loading', draft: null, text: '', dirty: false, canRetry: false });
const emptyHistory = (): DraftHistoryState => ({ phase: 'loading', draft: null, items: [], hasMore: false });

/** A keyed scope prevents private prose surviving any owner/project/draft change. */
export function DraftEditing(props: DraftEditingProps) {
  const identity = [props.ownerId, props.projectId, props.draftId, props.storyLanguage, props.baseUrl, props.mode].join(':');
  return props.mode === 'edit' ? <Editor key={identity} {...props} /> : <History key={identity} {...props} />;
}

function useRequests({ baseUrl, projectId, draftId, storyLanguage, getAccessToken, ownerId }: DraftEditingProps) {
  const aliveRef = useRef(false), activeRef = useRef(true), busyRef = useRef(false), blockedRef = useRef(false);
  const epoch = useRef(0), request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => { epoch.current++; request.current?.abort(); request.current = null; busyRef.current = false; }, []);
  const begin = useCallback(() => {
    if (!aliveRef.current || !activeRef.current || busyRef.current || blockedRef.current) return null;
    const controller = new AbortController(), version = ++epoch.current;
    busyRef.current = true; request.current = controller;
    const current = () => aliveRef.current && activeRef.current && epoch.current === version && !controller.signal.aborted;
    const finish = () => { if (current()) { busyRef.current = false; request.current = null; } };
    return { controller, current, finish };
  }, []);
  const options = useCallback((controller: AbortController) => {
    if (!baseUrl || readStoryPreviewEnabled()) throw new StoryProjectsError('configuration');
    return { baseUrl: baseUrl, projectId: projectId, draftId: draftId,
      expectedLanguage: storyLanguage, getAccessToken: () => getAccessToken(ownerId), signal: controller.signal };
  }, [baseUrl, projectId, draftId, storyLanguage, getAccessToken, ownerId]);
  return { aliveRef, activeRef, busyRef, blockedRef, cancel, begin, options };
}

function Editor(props: DraftEditingProps) {
  const { language, onBack } = props;
  const { aliveRef, activeRef, blockedRef, cancel, begin, options } = useRequests(props);
  const [state, setState] = useState<DraftEditingState>(emptyEditor);
  const latest = useRef<DraftEditingState>(emptyEditor());
  // Kept in RAM only. An uncertain retry always uses this exact frozen payload.
  const attempt = useRef<{ baseline: StoryDraft; input: DraftEditInput } | null>(null);
  const warningOpen = useRef(false);
  const publish = useCallback((value: DraftEditingState) => { latest.current = value; setState(value); }, []);
  const clear = useCallback(() => { attempt.current = null; warningOpen.current = false; publish(emptyEditor()); }, [publish]);
  const fail = useCallback((error: unknown) => {
    const safe = safeError(error);
    if (accessFailure(safe)) { blockedRef.current = true; attempt.current = null; publish({ ...emptyEditor(), phase: 'error', error: safe.kind }); }
    else publish({ ...latest.current, phase: attempt.current ? 'uncertain' : latest.current.draft ? 'editing' : 'error', error: safe.kind, canRetry: false });
  }, [blockedRef, publish]);
  const reload = useCallback(() => {
    const op = begin(); if (!op) return;
    clear();
    void Promise.resolve().then(() => getStoryDraft(options(op.controller))).then(draft => {
      if (op.current()) publish({ phase: 'editing', draft, text: draft.content, dirty: false, canRetry: false });
    }).catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  }, [begin, clear, options, publish, fail]);
  useEffect(() => {
    aliveRef.current = true;
    activeRef.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    void Promise.resolve().then(() => { if (aliveRef.current) reload(); });
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { activeRef.current = false; cancel(); clear(); }
      else if (!activeRef.current) { activeRef.current = true; reload(); }
    });
    return () => { aliveRef.current = false; cancel(); attempt.current = null; listener.remove(); };
  }, [aliveRef, activeRef, cancel, clear, reload]);

  const leave = useCallback(() => {
    const finish = () => {
      if (!aliveRef.current || !activeRef.current) return;
      activeRef.current = false; cancel(); clear(); onBack();
    };
    if (!latest.current.dirty && !attempt.current) { finish(); return; }
    if (warningOpen.current) return;
    warningOpen.current = true;
    const copy = draftEditingCopy[language];
    Alert.alert(copy.discardTitle, copy.discardHelp, [
      { text: copy.stay, style: 'cancel', onPress: () => { warningOpen.current = false; } },
      { text: copy.discard, style: 'destructive', onPress: () => { warningOpen.current = false; finish(); } },
    ], { cancelable: false });
  }, [aliveRef, activeRef, cancel, clear, onBack, language]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true; });
    return () => listener.remove();
  }, [leave]);

  const accepted = (draft: StoryDraft) => {
    attempt.current = null;
    publish({ phase: 'saved', draft, text: draft.content, dirty: false, canRetry: false });
  };
  const reconcile = async (op: NonNullable<ReturnType<typeof begin>>, conflict = false) => {
    const pending = attempt.current; if (!pending) return;
    const remote = await getStoryDraft(options(op.controller));
    if (!op.current()) return;
    if (!sameDraftOriginal(remote, pending.baseline) || remote.revision < pending.baseline.revision) {
      throw new StoryProjectsError('invalid-response');
    }
    const { input, baseline } = pending;
    if (remote.content === input.content && ((remote.revision === baseline.revision && input.content === baseline.content) ||
      remote.revision === baseline.revision + 1)) { accepted(remote); return; }
    if (!conflict && remote.revision === baseline.revision && remote.content === baseline.content) {
      publish({ ...latest.current, phase: 'uncertain', error: undefined, canRetry: true });
    } else {
      publish({ ...latest.current, phase: 'conflict', error: undefined, compare: remote, canRetry: false });
    }
  };
  const send = async (op: NonNullable<ReturnType<typeof begin>>) => {
    const pending = attempt.current; if (!pending) return;
    publish({ ...latest.current, phase: 'saving', error: undefined, validation: undefined, canRetry: false });
    try {
      const saved = await editStoryDraft({ ...options(op.controller), ...pending });
      if (op.current()) accepted(saved);
    } catch (error) {
      if (!op.current()) return;
      const safe = safeError(error);
      if (accessFailure(safe)) { fail(safe); return; }
      const uncertain = safe.mayHaveWritten || ['timeout', 'network', 'invalid-response', 'cancelled'].includes(safe.kind);
      if (safe.kind === 'conflict' || uncertain) {
        publish({ ...latest.current, phase: 'uncertain', error: safe.kind, canRetry: false });
        try { await reconcile(op, safe.kind === 'conflict'); }
        catch (readError) {
          if (!op.current()) return;
          if (accessFailure(safeError(readError))) fail(readError);
          else publish({ ...latest.current, phase: 'uncertain', error: safeError(readError).kind, canRetry: false });
        }
      } else { attempt.current = null; fail(safe); }
    }
  };
  const save = () => {
    const value = latest.current;
    if (!value.draft || !['editing', 'saved', 'error'].includes(value.phase) || attempt.current) return;
    let input: DraftEditInput;
    try { input = validateDraftEditInput({ content: value.text, expected_revision: value.draft.revision }); }
    catch {
      const validation = [...value.text].length > 20_000 ? 'too-long'
        : /\0|\p{Cs}/u.test(value.text) ? 'invalid' : 'required';
      publish({ ...value, phase: 'editing', validation, error: undefined }); return;
    }
    const op = begin(); if (!op) return;
    attempt.current = { baseline: value.draft, input: Object.freeze({ ...input }) };
    void send(op).finally(op.finish);
  };
  const check = () => {
    if (!attempt.current) {
      if (!latest.current.draft) reload();
      else publish({ ...latest.current, phase: 'editing', error: undefined });
      return;
    }
    if (latest.current.phase !== 'uncertain') return;
    const op = begin(); if (!op) return;
    publish({ ...latest.current, phase: 'saving', error: undefined, canRetry: false });
    void reconcile(op).catch(error => {
      if (!op.current()) return;
      if (accessFailure(safeError(error))) fail(error);
      else publish({ ...latest.current, phase: 'uncertain', error: safeError(error).kind, canRetry: false });
    }).finally(op.finish);
  };
  const retry = () => {
    if (!attempt.current || !latest.current.canRetry || latest.current.phase !== 'uncertain') return;
    const op = begin(); if (!op) return;
    // Re-read again immediately before an explicit exact retry; never auto-write.
    publish({ ...latest.current, phase: 'saving', canRetry: false });
    void reconcile(op).then(async () => {
      if (op.current() && latest.current.phase === 'uncertain' && latest.current.canRetry) await send(op);
    }).catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  };
  const choose = (keepMine: boolean) => {
    const value = latest.current, remote = value.compare;
    if (value.phase !== 'conflict' || !remote) return;
    attempt.current = null;
    const text = keepMine ? value.text : remote.content;
    publish({ phase: 'editing', draft: remote, text, dirty: text !== remote.content, canRetry: false });
  };
  return <DraftEditorScreen language={props.language} storyLanguage={props.storyLanguage} title={props.title} state={state}
    onChangeText={text => {
      const value = latest.current;
      if (!value.draft || !['editing', 'saved', 'error'].includes(value.phase) || attempt.current) return;
      publish({ ...value, phase: 'editing', text, dirty: text !== value.draft.content, validation: undefined, error: undefined });
    }} onSave={save} onCheck={check} onRetry={retry} onUseLatest={() => choose(false)} onKeepMine={() => choose(true)}
    onBack={leave} onSignOut={() => { activeRef.current = false; cancel(); clear(); props.onSignOut(); }} />;
}

/** Validates revision continuity across page boundaries without inventing rows. */
export function coherentHistory(draft: StoryDraft, items: StoryEdit[], hasMore: boolean): boolean {
  if (!items.length) return draft.revision === 1 && !hasMore;
  if (items[0].revision !== draft.revision || items[0].content !== draft.content) return false;
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const row = items[index];
    if (row.draft_id !== draft.draft_id || ids.has(row.id) || row.revision !== draft.revision - index) return false;
    ids.add(row.id);
    if (index && items[index - 1].previous_content !== row.content) return false;
  }
  const last = items[items.length - 1];
  if (last.revision === 2) return last.previous_content === draft.original_content;
  return hasMore && last.revision > 2;
}

function History(props: DraftEditingProps) {
  const { aliveRef, activeRef, blockedRef, cancel, begin, options } = useRequests(props);
  const [state, setState] = useState<DraftHistoryState>(emptyHistory);
  const latest = useRef<DraftHistoryState>(emptyHistory());
  const publish = useCallback((value: DraftHistoryState) => { latest.current = value; setState(value); }, []);
  const clear = useCallback(() => publish(emptyHistory()), [publish]);
  const read = useCallback((more = false) => {
    const previous = latest.current;
    if (more && (previous.phase !== 'ready' || !previous.draft || !previous.hasMore)) return;
    const op = begin(); if (!op) return;
    publish(more ? { ...previous, phase: 'loading-more', error: undefined } : emptyHistory());
    void (async () => {
      const api = options(op.controller);
      const draft = await getStoryDraft(api);
      if (!op.current()) return;
      if (more && previous.draft && (!sameDraftOriginal(draft, previous.draft) || draft.revision !== previous.draft.revision ||
        draft.content !== previous.draft.content)) throw new StoryProjectsError('conflict');
      const prior = more ? previous.items : [];
      const page = await listDraftHistory({ ...api, limit: 2, offset: prior.length });
      if (!op.current()) return;
      const current = await getStoryDraft(api);
      if (!op.current()) return;
      if (!sameDraftOriginal(draft, current) || current.revision !== draft.revision || current.content !== draft.content) {
        throw new StoryProjectsError('conflict');
      }
      const items = prior.concat(page.items);
      if (!coherentHistory(current, items, page.hasMore)) throw new StoryProjectsError('invalid-response');
      const hasMore = page.hasMore && items[items.length - 1]?.revision > 2;
      const bounded = hasMore && items.length >= 200;
      publish({ phase: 'ready', draft: current, items, hasMore: hasMore && !bounded, bounded });
    })().catch(error => {
      if (!op.current()) return;
      const safe = safeError(error);
      if (accessFailure(safe)) blockedRef.current = true;
      // Discard mixed pages on conflict/failure. Refresh starts from revision-consistent page 1.
      publish({ ...emptyHistory(), phase: 'error', error: safe.kind });
    }).finally(op.finish);
  }, [begin, options, publish, blockedRef]);
  useEffect(() => {
    aliveRef.current = true;
    activeRef.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    void Promise.resolve().then(() => { if (aliveRef.current) read(); });
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { activeRef.current = false; cancel(); clear(); }
      else if (!activeRef.current) { activeRef.current = true; read(); }
    });
    return () => { aliveRef.current = false; cancel(); listener.remove(); };
  }, [aliveRef, activeRef, cancel, clear, read]);
  const leave = useCallback((destination: () => void) => { activeRef.current = false; cancel(); clear(); destination(); }, [activeRef, cancel, clear]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(props.onBack); return true; });
    return () => listener.remove();
  }, [leave, props.onBack]);
  return <DraftHistoryScreen language={props.language} storyLanguage={props.storyLanguage} title={props.title} state={state}
    onLoadMore={() => read(true)} onRefresh={() => read()} onBack={() => leave(props.onBack)} onSignOut={() => leave(props.onSignOut)} />;
}
