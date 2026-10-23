import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getStoryDraft, sameDraftOriginal, type StoryDraft } from '../api/story-drafts';
import { exportStoryPdf, downloadStoryPdf, listStoryExports, StoryExportsError, type StoryExport, type StoryPdf } from '../api/story-exports';
import { getStoryProject, StoryProjectsError } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { NativePdfError, type PrivatePdfStore, type PrivatePdfHandle } from './native-pdf';
import { usePdfPrivacy } from './PdfPrivacy';
import { StoryExportsScreen, type ExportScreenState } from './StoryExportsScreen';

export interface StoryExportsProps {
  language: Language; storyLanguage: Language; title: string; ownerId: string; projectId: string; draftId: string;
  baseUrl: string | null; getAccessToken: (owner: string) => Promise<string | null>;
  onBack: () => void; onSignOut: () => void;
}
const empty = (): ExportScreenState => ({ phase: 'loading', draft: null, items: [], hasMore: false, fileReady: false });
const accessFailure = (error: StoryProjectsError) => ['authentication', 'forbidden', 'not-found'].includes(error.kind);
const safeError = (error: unknown) => error instanceof StoryProjectsError ? error
  : new StoryProjectsError(error instanceof NativePdfError && error.kind === 'invalid' ? 'invalid-response' : 'unavailable');
type Selection = { draft: StoryDraft; title: string; hash: string };
const sameSelection = (a: Selection, b: Selection) => sameDraftOriginal(a.draft, b.draft) &&
  a.draft.revision === b.draft.revision && a.draft.content === b.draft.content && a.title === b.title && a.hash === b.hash;
const matches = (item: StoryExport, selected: Selection) => item.draft_id === selected.draft.draft_id &&
  item.draft_version === selected.draft.version && item.draft_revision === selected.draft.revision &&
  item.title === selected.title && item.content_sha256 === selected.hash &&
  item.include_title_page && item.include_page_numbers && item.renderer_version === 'memy_pdf_v1';

export function StoryExports(props: StoryExportsProps) {
  const identity = [props.ownerId, props.projectId, props.draftId, props.storyLanguage, props.baseUrl].join(':');
  return <ScopedExports key={identity} {...props} />;
}
function ScopedExports(props: StoryExportsProps) {
  const { ownerId, projectId, draftId, storyLanguage, baseUrl, getAccessToken, onBack, onSignOut } = props;
  const privacy = usePdfPrivacy();
  const { ready, failed, createStore, release, reportFailure, rememberReturn, clearReturn } = privacy;
  const [state, setState] = useState<ExportScreenState>(empty);
  const [title, setTitle] = useState(props.title);
  const latest = useRef<ExportScreenState>(empty()), alive = useRef(false), active = useRef(true), busy = useRef(false), blocked = useRef(false);
  const epoch = useRef(0), request = useRef<AbortController | null>(null);
  const store = useRef<PrivatePdfStore | null>(null), file = useRef<PrivatePdfHandle | null>(null);
  // Private selected wording and uncertain action survive only inside this scope's RAM.
  const pending = useRef<Selection | null>(null);
  const publish = useCallback((value: ExportScreenState) => { latest.current = value; setState(value); }, []);
  const cancel = useCallback(() => { epoch.current++; request.current?.abort(); request.current = null; busy.current = false; }, []);
  const clear = useCallback(() => {
    pending.current = null; file.current = null;
    if (store.current) { release(store.current); store.current = null; }
    publish(empty());
  }, [release, publish]);
  const begin = useCallback(() => {
    if (!alive.current || !active.current || busy.current || blocked.current || !store.current || !ready || failed) return null;
    busy.current = true; const controller = new AbortController(), version = ++epoch.current;
    request.current = controller;
    const current = () => alive.current && active.current && epoch.current === version && !controller.signal.aborted;
    const finish = () => { if (current()) { busy.current = false; request.current = null; } };
    return { controller, current, finish, cache: store.current };
  }, [ready, failed]);
  const options = useCallback((controller: AbortController) => {
    if (!baseUrl || readStoryPreviewEnabled()) throw new StoryProjectsError('configuration');
    return { baseUrl, projectId, draftId, expectedLanguage: storyLanguage,
      getAccessToken: () => getAccessToken(ownerId), signal: controller.signal };
  }, [baseUrl, projectId, draftId, storyLanguage, getAccessToken, ownerId]);
  const fail = useCallback((error: unknown, uncertain = false) => {
    if (error instanceof NativePdfError && error.kind === 'cleanup') {
      reportFailure(); publish({ ...empty(), phase: 'error', notice: 'cleanup-failed' }); return;
    }
    const safe = safeError(error);
    if (accessFailure(safe)) {
      blocked.current = true; clear();
      publish({ ...empty(), phase: 'error', error: safe.kind }); return;
    }
    publish({ ...latest.current, phase: uncertain ? 'uncertain' : 'error', fileReady: false, prepared: undefined,
      error: safe.kind, ...(safe instanceof StoryExportsError && safe.code ? { code: safe.code } : {}) });
  }, [clear, publish, reportFailure]);
  const readSelection = useCallback(async (controller: AbortController): Promise<Selection> => {
    const api = options(controller);
    const draft = await getStoryDraft(api);
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    const project = await getStoryProject(api);
    if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
    if (project.id !== projectId || project.language !== storyLanguage) throw new StoryProjectsError('invalid-response');
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, draft.content);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new StoryProjectsError('invalid-response');
    return { draft, title: project.title, hash };
  }, [options, projectId, storyLanguage]);
  const discard = useCallback(async (cache: PrivatePdfStore) => {
    const handle = file.current; file.current = null;
    if (handle) await cache.discard(handle);
  }, []);
  const find = useCallback(async (controller: AbortController, predicate: (item: StoryExport) => boolean) => {
    let items: StoryExport[] = [];
    let anchor: string[] | null = null;
    for (let offset = 0; offset < 200; offset += 20) {
      const page = await listStoryExports({ ...options(controller), limit: 20, offset });
      if (controller.signal.aborted) throw new StoryProjectsError('cancelled');
      if (!anchor) anchor = page.items.map(item => item.export_id);
      const seen = new Set(items.map(item => item.export_id));
      if (page.items.some(item => seen.has(item.export_id))) throw new StoryProjectsError('conflict');
      items = items.concat(page.items);
      const found = page.items.find(predicate);
      if (found) return { found, items, hasMore: page.hasMore, bounded: false };
      if (!page.hasMore) {
        const recheck = await listStoryExports({ ...options(controller), limit: 20, offset: 0 });
        if (JSON.stringify(recheck.items.map(item => item.export_id)) !== JSON.stringify(anchor)) throw new StoryProjectsError('conflict');
        return { found, items, hasMore: false, bounded: false };
      }
    }
    return { found: undefined, items, hasMore: false, bounded: true };
  }, [options]);
  const receive = useCallback(async (op: NonNullable<ReturnType<typeof begin>>, pdf: StoryPdf, audit: StoryExport) => {
    let handle: PrivatePdfHandle | null = null;
    try {
      if (!op.current()) return;
      handle = await op.cache.save(pdf.bytes);
      if (!op.current()) { await op.cache.discard(handle); return; }
      file.current = handle;
      pending.current = null;
      publish({ ...latest.current, phase: 'ready', fileReady: true, prepared: audit, preparedPageCount: pdf.pageCount,
        selectedExportId: audit.export_id, notice: 'prepared', error: undefined, code: undefined });
    } catch (error) {
      if (error instanceof NativePdfError && error.kind === 'cleanup') reportFailure();
      throw error;
    } finally { pdf.bytes.fill(0); }
  }, [publish, reportFailure]);
  const openAudit = useCallback(async (op: NonNullable<ReturnType<typeof begin>>, audit: StoryExport) => {
    if (!op.current()) return;
    const pdf = await downloadStoryPdf({ ...options(op.controller), metadata: audit });
    await receive(op, pdf, audit);
  }, [options, receive]);
  const checkPending = async (op: NonNullable<ReturnType<typeof begin>>, selection: Selection) => {
    const result = await find(op.controller, item => matches(item, selection));
    if (!op.current()) return;
    publish({ ...latest.current, items: result.items, hasMore: result.hasMore, bounded: result.bounded });
    if (result.found) { await openAudit(op, result.found); return; }
    // A bounded/incomplete search never proves that no matching audit exists.
    publish({ ...latest.current, phase: result.bounded ? 'uncertain' : 'ready',
      notice: 'uncertain', error: undefined, code: undefined });
  };
  const refresh = useCallback(() => {
    const op = begin(); if (!op) return;
    publish({ ...empty(), phase: pending.current ? 'checking' : 'loading' });
    void (async () => {
      await discard(op.cache);
      const selected = await readSelection(op.controller);
      if (!op.current()) return;
      setTitle(selected.title);
      publish({ ...empty(), phase: 'checking', draft: selected.draft });
      const original = pending.current;
      if (original) {
        if (!sameSelection(original, selected)) {
          pending.current = null;
          publish({ ...latest.current, phase: 'error', notice: 'source-changed', error: 'conflict' }); return;
        }
        // Reconciliation may download an existing audited PDF; it never writes.
        const result = await find(op.controller, item => matches(item, original));
        if (!op.current()) return;
        publish({ ...latest.current, items: result.items, hasMore: result.hasMore, bounded: result.bounded });
        if (result.found) await openAudit(op, result.found);
        else publish({ ...latest.current, phase: result.bounded ? 'uncertain' : 'ready', notice: 'uncertain' });
      } else {
        const page = await listStoryExports({ ...options(op.controller), limit: 20, offset: 0 });
        if (op.current()) publish({ ...latest.current, phase: 'ready', items: page.items, hasMore: page.hasMore });
      }
    })().catch(error => { if (op.current()) fail(error, !!pending.current); }).finally(op.finish);
  }, [begin, publish, discard, readSelection, find, options, fail, openAudit]);
  useEffect(() => {
    alive.current = true;
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const initialize = () => {
      if (!alive.current || !active.current || !ready || failed) return;
      try { store.current = createStore(ownerId); refresh(); } catch (error) { fail(error); }
    };
    void Promise.resolve().then(initialize);
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { active.current = false; cancel(); clear(); }
      else if (!active.current) { active.current = true; initialize(); }
    });
    return () => { alive.current = false; cancel(); clear(); listener.remove(); };
  }, [ready, failed, createStore, ownerId, refresh, fail, cancel, clear]);
  const prepare = () => {
    const shown = latest.current;
    if (shown.phase !== 'ready' || shown.error || !shown.draft) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'exporting', fileReady: false, prepared: undefined, notice: undefined });
    void (async () => {
      await discard(op.cache);
      const selected = await readSelection(op.controller);
      if (!op.current()) return;
      if (!sameDraftOriginal(shown.draft!, selected.draft) || shown.draft!.revision !== selected.draft.revision ||
        shown.draft!.content !== selected.draft.content || title !== selected.title) {
        pending.current = null; setTitle(selected.title);
        publish({ ...empty(), phase: 'error', draft: selected.draft, error: 'conflict', notice: 'source-changed' }); return;
      }
      if (pending.current && !sameSelection(pending.current, selected)) throw new StoryProjectsError('conflict');
      pending.current = selected;
      const existing = await find(op.controller, item => matches(item, selected));
      if (!op.current()) return;
      publish({ ...latest.current, items: existing.items, hasMore: existing.hasMore, bounded: existing.bounded });
      if (existing.found) { await openAudit(op, existing.found); return; }
      if (existing.bounded) { publish({ ...latest.current, phase: 'uncertain', notice: 'uncertain' }); return; }
      const pdf = await exportStoryPdf({ ...options(op.controller), baseline: selected.draft, title: selected.title });
      try {
        if (!op.current()) return;
        const result = await find(op.controller, item => item.export_id === pdf.exportId);
        if (!op.current()) return;
        const audit = result.found;
        if (!audit || !matches(audit, selected) || audit.filename !== pdf.filename) throw new StoryProjectsError('invalid-response', undefined, true);
        publish({ ...latest.current, items: result.items, hasMore: result.hasMore, bounded: result.bounded });
        await receive(op, pdf, audit);
      } finally { pdf.bytes.fill(0); }
    })().catch(async error => {
      if (!op.current()) return;
      const safe = safeError(error);
      if (accessFailure(safe)) { fail(safe); return; }
      if (error instanceof NativePdfError) { fail(error); return; }
      if (safe.retry) {
        // A wait during export verification cannot discard an earlier uncertain
        // snapshot or start more reads. Refresh reconciles explicitly afterward.
        fail(safe, !!pending.current);
        return;
      }
      if (safe.kind === 'conflict') {
        pending.current = null;
        try {
          const actual = await readSelection(op.controller);
          if (op.current()) { setTitle(actual.title); publish({ ...empty(), phase: 'error', draft: actual.draft, error: 'conflict', notice: 'source-changed' }); }
        } catch (readError) { if (op.current()) fail(readError); }
        return;
      }
      const uncertain = safe.mayHaveWritten || ['timeout', 'network', 'invalid-response', 'cancelled'].includes(safe.kind);
      if (uncertain && pending.current) {
        publish({ ...latest.current, phase: 'uncertain', fileReady: false, error: safe.kind, notice: 'uncertain' });
        try { await checkPending(op, pending.current); } catch (next) { if (op.current()) fail(next, true); }
      } else { pending.current = null; fail(error); }
    }).finally(op.finish);
  };
  const download = (id: string) => {
    const shown = latest.current, audit = shown.items.find(item => item.export_id === id);
    if (!audit || shown.phase !== 'ready' || shown.error || pending.current) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'downloading', fileReady: false, prepared: undefined, notice: undefined });
    void discard(op.cache).then(() => openAudit(op, audit))
      .catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  };
  const more = () => {
    const shown = latest.current;
    if (shown.phase !== 'ready' || !shown.hasMore || shown.items.length >= 200 || pending.current) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'checking' });
    void listStoryExports({ ...options(op.controller), limit: 20, offset: shown.items.length }).then(page => {
      if (!op.current()) return;
      const seen = new Set(shown.items.map(item => item.export_id));
      if (page.items.some(item => seen.has(item.export_id))) throw new StoryProjectsError('conflict');
      const items = shown.items.concat(page.items), bounded = page.hasMore && items.length >= 200;
      publish({ ...shown, items, hasMore: page.hasMore && !bounded, bounded, phase: 'ready' });
    }).catch(error => { if (op.current()) fail(error); }).finally(op.finish);
  };
  const share = () => {
    const shown = latest.current, handle = file.current;
    if (shown.phase !== 'ready' || !shown.fileReady || !shown.prepared || shown.error || !handle) return;
    const op = begin(); if (!op) return;
    publish({ ...shown, phase: 'sharing', fileReady: false });
    void (async () => {
      // Recheck authentication immediately before deliberate disclosure.
      let token: string | null;
      try { token = await getAccessToken(ownerId); } catch { throw new StoryProjectsError('authentication'); }
      if (!token || /^sb_(publishable|secret)_/.test(token)) throw new StoryProjectsError('authentication');
      if (!op.current()) return;
      rememberReturn(ownerId, projectId, draftId);
      await op.cache.share(handle);
      if (op.current()) publish({ ...latest.current, phase: 'ready', fileReady: false, prepared: undefined, notice: 'shared' });
    })().catch(error => {
      if (error instanceof NativePdfError && error.kind === 'cleanup') reportFailure();
      if (op.current()) fail(error);
    }).finally(async () => {
      try { await op.cache.discard(handle); } catch { reportFailure(); }
      if (op.current()) clearReturn(ownerId);
      if (file.current === handle) file.current = null;
      op.finish();
    });
  };
  const leave = useCallback((destination: () => void) => { active.current = false; cancel(); clear(); clearReturn(ownerId); destination(); }, [cancel, clear, clearReturn, ownerId]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(onBack); return true; });
    return () => listener.remove();
  }, [leave, onBack]);
  const visible = failed ? { ...empty(), phase: 'error' as const, notice: 'cleanup-failed' as const } : state;
  return <StoryExportsScreen language={props.language} storyLanguage={storyLanguage} title={title} state={visible}
    onPrepare={prepare} onShare={share} onDownload={download} onLoadMore={more} onRefresh={refresh}
    onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
