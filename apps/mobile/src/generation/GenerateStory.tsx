import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import type { AuthUser } from '../auth/client';
import { readMobileApiConfig } from '../api/config';
import { generateStoryDraft, getStoryDraft, getStoryVerification, listStoryDrafts, StoryDraftsError } from '../api/story-drafts';
import { StoryProjectsError, type StoryProject } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { createGenerationActionId, useGenerationActions, type GenerationAction } from './GenerationActions';
import { StoryDraftScreen, type DraftScreenState } from './StoryDraftScreen';
import { DraftEditing } from './DraftEditing';
import { StoryExports } from '../exports/StoryExports';
import { GenerationBrowser } from './GenerationBrowser';

interface Props {
  initialDraftId?: string;
  language: Language;
  user: AuthUser;
  project: StoryProject;
  getAccessToken: (expectedOwner: string) => Promise<string | null>;
  onBack: () => void;
  onReviewMemories: (selectedDraftId?: string) => void;
  onContinueStory?: (selectedDraftId: string) => void;
  onSelectionChange?: (selectedDraftId: string) => void;
  onSignOut: () => void;
}
const empty = (phase: DraftScreenState['phase']): DraftScreenState => ({
  phase, draft: null, verification: null, canRetry: false,
});
const accessFailure = (error: StoryProjectsError) => ['authentication', 'forbidden', 'not-found'].includes(error.kind);
export function GenerateStory(props: Props) {
  const [config] = useState(readMobileApiConfig);
  const identity = [props.user.id, props.project.id, props.project.language, config?.baseUrl, props.initialDraftId].join(':');
  return <ScopedGeneration key={identity} {...props} baseUrl={config?.baseUrl ?? null} />;
}
function ScopedGeneration({ language, user, project, baseUrl, getAccessToken,
  onBack, onReviewMemories, onContinueStory, onSelectionChange, onSignOut, initialDraftId }: Props & { baseUrl: string | null }) {
  const actions = useGenerationActions(user.id);
  const scope = [baseUrl, project.id, project.language, 'warm'].join(':');
  const [state, setState] = useState<DraftScreenState>(() => empty('loading'));
  const [subview, setSubview] = useState<{ mode: 'edit' | 'history' | 'export' | 'generations'; draftId: string; token: number } | null>(null);
  const subviewRef = useRef(false);
  const subviewToken = useRef(0);
  const alive = useRef(false), active = useRef(true), busy = useRef(false), blocked = useRef(false);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const selectedDraftId = useRef<string | null>(initialDraftId ?? actions.getSelection(user.id, scope) ?? null);
  const selectionCallback = useRef(onSelectionChange);
  useLayoutEffect(() => { selectionCallback.current = onSelectionChange; }, [onSelectionChange]);
  const rememberSelection = useCallback((id: string) => {
    selectedDraftId.current = id; actions.select(user.id, scope, id); selectionCallback.current?.(id);
  }, [actions, user.id, scope]);
  const previousGeneration = useRef<{ draftId: string; version: number } | null>(null);
  const currentState = useRef<DraftScreenState>(empty('loading'));
  const publish = useCallback((value: DraftScreenState) => {
    currentState.current = value;
    setState(value);
  }, []);
  const cancel = useCallback(() => {
    epoch.current += 1; request.current?.abort(); request.current = null; busy.current = false;
  }, []);
  const begin = useCallback(() => {
    if (!alive.current || !active.current || busy.current || blocked.current) return null;
    busy.current = true;
    const controller = new AbortController();
    const version = ++epoch.current; request.current = controller;
    const current = () => alive.current && active.current && epoch.current === version && !controller.signal.aborted;
    const finish = () => { if (current()) { busy.current = false; request.current = null; } };
    return { controller, current, finish };
  }, []);
  const options = useCallback((controller: AbortController) => {
    if (!baseUrl || readStoryPreviewEnabled()) throw new StoryProjectsError('configuration');
    return { baseUrl, projectId: project.id, expectedLanguage: project.language,
      getAccessToken: () => getAccessToken(user.id), signal: controller.signal };
  }, [baseUrl, project.id, project.language, getAccessToken, user.id]);
  const load = useCallback(async (controller: AbortController, selected: string | null): Promise<DraftScreenState> => {
    const api = options(controller);
    const latest = await listStoryDrafts(api);
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    const id = selected ?? latest[0]?.draft_id;
    let draft = id ? await getStoryDraft({ ...api, draftId: id }) : null;
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    const report = await getStoryVerification(api);
    if (!draft && report.draft_id !== null) {
      const reloaded = await listStoryDrafts(api);
      if (!reloaded[0]) throw new StoryProjectsError('invalid-response');
      draft = await getStoryDraft({ ...api, draftId: reloaded[0].draft_id });
    }
    const matching = !!draft && report.draft_id === draft.draft_id &&
      report.version === draft.version && report.revision === draft.revision;
    const coherent = matching && draft && ((draft.status === 'edited' && report.verification.status === 'needs_review') ||
      (draft.status === 'ready_for_review' && ['passed', 'stale_sources'].includes(report.verification.status)));
    if (draft && coherent) draft = { ...draft, verification: report.verification };
    else if (draft) {
      // Project report describes max generation, not necessarily a replay's older
      // draft. Read the selected draft's report; never transfer another's status.
      draft = await getStoryDraft({ ...api, draftId: draft.draft_id });
    }
    return { phase: 'ready', draft, verification: coherent || (!draft && report.draft_id === null) ? report : null, canRetry: false };
  }, [options]);
  const fail = useCallback((error: unknown, uncertain: boolean) => {
    const safe = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, uncertain);
    if (accessFailure(safe)) blocked.current = true;
    publish({ ...empty(uncertain && !accessFailure(safe) ? 'uncertain' : 'error'), error: safe.kind,
      ...(safe instanceof StoryDraftsError && safe.code ? { code: safe.code } : {}) });
  }, [publish]);
  const refresh = useCallback(() => {
    if (subviewRef.current) return;
    const operation = begin(); if (!operation) return;
    const { controller, current, finish } = operation;
    publish(empty('loading'));
    void load(controller, selectedDraftId.current).then(result => {
      if (!current()) return;
      if (result.draft) rememberSelection(result.draft.draft_id);
      const action = actions.get(user.id, scope);
      const comparison = previousGeneration.current;
      const shown = { ...result, ...(comparison && comparison.draftId !== result.draft?.draft_id ? { previousGeneration: comparison } : {}) };
      if (action?.blocked) publish({ ...shown, phase: 'error', canRetry: false,
        error: 'conflict', code: 'IDEMPOTENCY_CONFLICT' });
      else publish({ ...shown, phase: action ? 'uncertain' : 'ready',
        canRetry: !!action, ...(action ? { notice: 'uncertain' as const } : {}) });
    }).catch(error => { if (current()) fail(error, !!actions.get(user.id, scope)); }).finally(finish);
  }, [begin, load, actions, user.id, scope, publish, fail, rememberSelection]);
  useEffect(() => {
    alive.current = true;
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const initialEpoch = epoch.current;
    void Promise.resolve().then(() => { if (alive.current && epoch.current === initialEpoch) refresh(); });
    const changes = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        active.current = false; cancel(); publish(empty('loading')); subviewRef.current = false; setSubview(null);
      } else if (!active.current) { active.current = true; refresh(); }
    });
    return () => { alive.current = false; cancel(); changes.remove(); };
  }, [refresh, cancel, publish]);

  const send = async (action: GenerationAction, operation: NonNullable<ReturnType<typeof begin>>) => {
    const { controller, current } = operation;
    try {
      publish(empty('generating'));
      const saved = await generateStoryDraft({ ...options(controller), idempotencyKey: action.key, input: action.input });
      if (!current()) return;
      selectedDraftId.current = saved.draft_id;
      const result = await load(controller, saved.draft_id);
      if (!current()) return;
      const actual = result.draft;
      if (!actual || actual.draft_id !== saved.draft_id || actual.version !== saved.version ||
        actual.project_id !== saved.project_id || actual.language !== saved.language || actual.style !== saved.style ||
        actual.mode !== saved.mode || actual.original_content !== saved.original_content ||
        actual.created_at !== saved.created_at || JSON.stringify(actual.source_memories) !== JSON.stringify(saved.source_memories) ||
        actual.revision < saved.revision || (actual.revision === saved.revision &&
          (actual.content !== saved.content || actual.status !== saved.status))) {
        throw new StoryProjectsError('invalid-response', undefined, true);
      }
      actions.remove(user.id, scope);
      rememberSelection(actual.draft_id);
      if (action.previousDraftId && action.previousVersion) {
        previousGeneration.current = { draftId: action.previousDraftId, version: action.previousVersion };
      }
      publish({ ...result, notice: 'saved', ...(previousGeneration.current && previousGeneration.current.draftId !== actual.draft_id
        ? { previousGeneration: previousGeneration.current } : {}) });
    } catch (error) {
      if (!current()) return;
      const safe = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
      // A wait can also interrupt verification after a successful POST, or an
      // exact retry of a previously uncertain action. Keep its original key and
      // payload until a deliberate reconciliation/retry resolves that action.
      const uncertain = !!safe.retry || safe.mayHaveWritten || ['network', 'timeout', 'invalid-response', 'cancelled'].includes(safe.kind);
      if (safe instanceof StoryDraftsError && safe.code === 'IDEMPOTENCY_CONFLICT') {
        actions.set(user.id, scope, { ...action, blocked: true });
      } else if (!uncertain) actions.remove(user.id, scope);
      fail(safe, uncertain);
    }
  };
  const generate = () => {
    if (subviewRef.current || currentState.current.phase !== 'ready' || actions.get(user.id, scope)) return;
    const operation = begin(); if (!operation) return;
    try {
      options(operation.controller);
      const action: GenerationAction = { key: createGenerationActionId(),
        input: { language: project.language, style: 'warm', confirm_generation: true },
        ...(currentState.current.draft ? { previousDraftId: currentState.current.draft.draft_id, previousVersion: currentState.current.draft.version } : {}) };
      if (!actions.set(user.id, scope, action)) throw new StoryProjectsError('authentication');
      void send(action, operation).finally(operation.finish);
    } catch (error) { fail(error instanceof StoryProjectsError ? error : new StoryProjectsError('configuration'), false); operation.finish(); }
  };
  const retry = () => {
    if (subviewRef.current) return;
    const action = actions.get(user.id, scope);
    if (!action || action.blocked || !currentState.current.canRetry) return;
    const operation = begin(); if (!operation) return;
    const { controller, current } = operation;
    publish(empty('checking'));
    void load(controller, selectedDraftId.current).then(async () => {
      if (current()) await send(action, operation);
    }).catch(error => { if (current()) fail(error, true); }).finally(operation.finish);
  };
  const leave = useCallback((destination: () => void, signOut = false) => {
    active.current = false; cancel(); publish(empty('loading'));
    if (signOut) actions.clear();
    destination();
  }, [cancel, publish, actions]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (subview) return false; // The editor owns its unsaved-wording warning.
      leave(onBack); return true;
    });
    return () => listener.remove();
  }, [leave, onBack, subview]);
  const open = (mode: 'edit' | 'history' | 'export' | 'generations') => {
    const value = currentState.current;
    if (subviewRef.current || value.phase !== 'ready' || !value.draft || value.error || value.canRetry || actions.get(user.id, scope)) return;
    cancel(); selectedDraftId.current = value.draft.draft_id;
    subviewRef.current = true; setSubview({ mode, draftId: value.draft.draft_id, token: ++subviewToken.current });
  };
  const ownsSubview = (token: number) => subviewRef.current && token === subviewToken.current;
  const closeSubview = (token: number) => { if (!ownsSubview(token)) return; subviewRef.current = false; setSubview(null); refresh(); };
  const selectGeneration = (draftId: string, token?: number) => {
    if (token !== undefined ? !ownsSubview(token) : subviewRef.current || currentState.current.phase !== 'ready') return;
    if (actions.get(user.id, scope)) return;
    const op = begin(); if (!op) return;
    const before = currentState.current.draft;
    subviewRef.current = false; setSubview(null); publish(empty('loading'));
    void load(op.controller, draftId).then(result => {
      if (!op.current()) return;
      if (result.draft?.draft_id !== draftId) throw new StoryProjectsError('invalid-response');
      rememberSelection(draftId);
      if (before && before.draft_id !== draftId) previousGeneration.current = { draftId: before.draft_id, version: before.version };
      const comparison = previousGeneration.current;
      publish({ ...result, notice: 'loaded', ...(comparison && comparison.draftId !== draftId ? { previousGeneration: comparison } : {}) });
    }).catch(error => { if (op.current()) fail(error, false); }).finally(op.finish);
  };
  const continueStory = () => {
    const shown = currentState.current;
    if (!onContinueStory || subviewRef.current || shown.phase !== 'ready' || shown.error || !shown.draft || actions.get(user.id, scope)) return;
    const id = shown.draft.draft_id, op = begin(); if (!op) return;
    publish(empty('checking'));
    // Revalidate the selected saved resource with the current owner's token.
    // The existing Conversation controller is the only continuation writer.
    void Promise.resolve().then(() => getStoryDraft({ ...options(op.controller), draftId: id })).then(() => {
      if (!op.current()) return;
      rememberSelection(id); leave(() => onContinueStory(id));
    }).catch(error => { if (op.current()) fail(error, false); }).finally(op.finish);
  };
  const childSignOut = (token: number) => { if (ownsSubview(token)) leave(onSignOut, true); };
  if (subview?.mode === 'generations') return <GenerationBrowser language={language} storyLanguage={project.language}
    title={project.title} ownerId={user.id} projectId={project.id} selectedDraftId={subview.draftId} baseUrl={baseUrl}
    getAccessToken={getAccessToken} onSelect={draft => selectGeneration(draft.draft_id, subview.token)}
    onBack={() => closeSubview(subview.token)} onSignOut={() => childSignOut(subview.token)} />;
  if (subview?.mode === 'export') return <StoryExports language={language} storyLanguage={project.language}
    title={project.title} ownerId={user.id} projectId={project.id} draftId={subview.draftId} baseUrl={baseUrl}
    getAccessToken={getAccessToken} onBack={() => closeSubview(subview.token)} onSignOut={() => childSignOut(subview.token)} />;
  if (subview) return <DraftEditing mode={subview.mode} language={language} storyLanguage={project.language}
    title={project.title} ownerId={user.id} projectId={project.id} draftId={subview.draftId} baseUrl={baseUrl}
    getAccessToken={getAccessToken} onBack={() => closeSubview(subview.token)}
    onSignOut={() => childSignOut(subview.token)} />;
  return <StoryDraftScreen language={language} storyLanguage={project.language} title={project.title} state={state}
    onGenerate={generate} onRetry={retry} onRefresh={refresh} onEdit={() => open('edit')} onHistory={() => open('history')} onExport={() => open('export')}
    onGenerations={() => open('generations')} onContinueStory={onContinueStory ? continueStory : undefined}
    onPreviousGeneration={() => { const previous = currentState.current.previousGeneration; if (previous) selectGeneration(previous.draftId); }}
    onReviewMemories={() => { if (!subviewRef.current && alive.current && active.current && !blocked.current) leave(() => onReviewMemories(selectedDraftId.current ?? undefined)); }} onBack={() => leave(onBack)}
    onSignOut={() => leave(onSignOut, true)} />;
}
