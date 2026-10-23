import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import { getStoryDraft, listStoryDraftsPage, sameDraftOriginal, type StoryDraft } from '../api/story-drafts';
import { StoryProjectsError } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { GenerationBrowserScreen, type GenerationBrowserState } from './GenerationBrowserScreen';

export interface GenerationBrowserProps {
  language: Language; storyLanguage: Language; title: string; ownerId: string; projectId: string;
  selectedDraftId: string | null; baseUrl: string | null;
  getAccessToken: (ownerId: string) => Promise<string | null>;
  onSelect: (draft: StoryDraft) => void; onBack: () => void; onSignOut: () => void;
}
const PAGE = 20, CAP = 200;
const empty = (): GenerationBrowserState => ({ phase: 'loading', items: [], hasMore: false });
const fingerprint = (items: StoryDraft[]) => JSON.stringify(items.map(item => [item.draft_id, item.version, item.revision]));
function ordered(items: StoryDraft[]) {
  const ids = new Set<string>(); let previous = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (ids.has(item.draft_id) || item.version >= previous) throw new StoryProjectsError('conflict');
    ids.add(item.draft_id); previous = item.version;
  }
}
/** Read-only saved-generation browser. Selection is explicit and verified again before leaving. */
export function GenerationBrowser(props: GenerationBrowserProps) {
  const scope = [props.ownerId, props.projectId, props.storyLanguage, props.baseUrl].join(':');
  return <ScopedBrowser key={scope} {...props} />;
}
function ScopedBrowser(props: GenerationBrowserProps) {
  const { baseUrl, ownerId, projectId, storyLanguage, getAccessToken, onSelect, onBack, onSignOut } = props;
  const [state, setState] = useState<GenerationBrowserState>(empty);
  const latest = useRef(state), anchor = useRef(''), alive = useRef(false), active = useRef(true);
  const busy = useRef(false), blocked = useRef(false), epoch = useRef(0), request = useRef<AbortController | null>(null);
  const publish = useCallback((next: GenerationBrowserState) => { latest.current = next; setState(next); }, []);
  const cancel = useCallback(() => { epoch.current++; request.current?.abort(); request.current = null; busy.current = false; }, []);
  const begin = useCallback(() => {
    if (!alive.current || !active.current || blocked.current || busy.current) return null;
    busy.current = true; const controller = new AbortController(), version = ++epoch.current;
    request.current = controller;
    const current = () => alive.current && active.current && version === epoch.current && !controller.signal.aborted;
    return { controller, current, finish: () => { if (current()) { busy.current = false; request.current = null; } } };
  }, []);
  const options = useCallback((controller: AbortController) => {
    if (!baseUrl || readStoryPreviewEnabled()) throw new StoryProjectsError('configuration');
    return { baseUrl, projectId, expectedLanguage: storyLanguage,
      getAccessToken: () => getAccessToken(ownerId), signal: controller.signal };
  }, [baseUrl, projectId, storyLanguage, getAccessToken, ownerId]);
  const fail = useCallback((error: unknown) => {
    const safe = error instanceof StoryProjectsError ? error : new StoryProjectsError('invalid-response');
    if (['authentication', 'forbidden', 'not-found'].includes(safe.kind)) blocked.current = true;
    // No stale list remains actionable after an unstable page or failed authorization.
    anchor.current = ''; publish({ ...empty(), phase: 'error', error: safe.kind });
  }, [publish]);
  const refresh = useCallback(() => {
    const op = begin(); if (!op) return;
    anchor.current = ''; publish(empty());
    void (async () => {
      const page = await listStoryDraftsPage({ ...options(op.controller), limit: PAGE, offset: 0 });
      if (!op.current()) return;
      ordered(page.items); anchor.current = fingerprint(page.items);
      publish({ phase: 'ready', items: page.items, hasMore: page.hasMore });
    })().catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  }, [begin, options, publish, fail]);
  const checkAnchor = async (controller: AbortController) => {
    const first = await listStoryDraftsPage({ ...options(controller), limit: PAGE, offset: 0 });
    if (fingerprint(first.items) !== anchor.current) throw new StoryProjectsError('conflict');
  };
  const checkWindow = async (controller: AbortController, items: StoryDraft[], offset: number) => {
    if (offset === 0) return; // Already checked by the first-page anchor.
    const actual = await listStoryDraftsPage({ ...options(controller), limit: PAGE, offset });
    if (fingerprint(actual.items) !== fingerprint(items.slice(offset, offset + PAGE))) throw new StoryProjectsError('conflict');
  };
  const more = () => {
    const shown = latest.current;
    if (shown.phase !== 'ready' || shown.error || !shown.hasMore || shown.items.length >= CAP) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'checking' });
    void (async () => {
      await checkAnchor(op.controller); if (!op.current()) return;
      const boundary = Math.floor((shown.items.length - 1) / PAGE) * PAGE;
      await checkWindow(op.controller, shown.items, boundary); if (!op.current()) return;
      const page = await listStoryDraftsPage({ ...options(op.controller), limit: PAGE, offset: shown.items.length });
      if (!op.current()) return;
      const items = shown.items.concat(page.items); ordered(items);
      // Offset pagination is not a snapshot; changed heads require a deliberate fresh check.
      await checkAnchor(op.controller); if (!op.current()) return;
      await checkWindow(op.controller, shown.items, boundary); if (!op.current()) return;
      const bounded = page.hasMore && items.length >= CAP;
      publish({ phase: 'ready', items, hasMore: page.hasMore && !bounded, bounded });
    })().catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  };
  const open = (id: string) => {
    const shown = latest.current, selected = shown.items.find(item => item.draft_id === id);
    if (!selected || shown.phase !== 'ready' || shown.error) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'checking' });
    void (async () => {
      await checkAnchor(op.controller); if (!op.current()) return;
      const selectedPage = Math.floor(shown.items.indexOf(selected) / PAGE) * PAGE;
      await checkWindow(op.controller, shown.items, selectedPage); if (!op.current()) return;
      const draft = await getStoryDraft({ ...options(op.controller), draftId: id });
      if (!op.current()) return;
      if (!sameDraftOriginal(selected, draft) || draft.revision < selected.revision) throw new StoryProjectsError('conflict');
      await checkAnchor(op.controller); if (!op.current()) return;
      await checkWindow(op.controller, shown.items, selectedPage); if (!op.current()) return;
      // No latest-generation verification endpoint, generation, edit, restore or PDF action occurs here.
      active.current = false; cancel(); publish(empty()); onSelect(draft);
    })().catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  };
  useEffect(() => {
    alive.current = true; active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    void Promise.resolve().then(() => { if (alive.current && active.current) refresh(); });
    const listener = AppState.addEventListener('change', next => {
      if (!alive.current) return;
      if (next !== 'active') { active.current = false; cancel(); anchor.current = ''; publish(empty()); }
      else if (!active.current) { active.current = true; refresh(); }
    });
    return () => { alive.current = false; cancel(); anchor.current = ''; listener.remove(); };
  }, [refresh, cancel, publish]);
  const leave = useCallback((destination: () => void) => {
    active.current = false; cancel(); anchor.current = ''; publish(empty()); destination();
  }, [cancel, publish]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(onBack); return true; });
    return () => listener.remove();
  }, [leave, onBack]);
  return <GenerationBrowserScreen language={props.language} storyLanguage={storyLanguage} title={props.title}
    selectedDraftId={props.selectedDraftId} state={state} onOpen={open} onLoadMore={more} onRefresh={refresh}
    onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
