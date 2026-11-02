import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AuthUser } from '../auth/client';
import { continueStoryProject, listStorySessions, StoryProjectsError, type StoryProject } from '../api/story-projects';
import type { AudioRecording } from '../api/audio-transcripts';
import type { StoryEdit } from '../api/story-drafts';
import { createNativeRecorder, createRecordingId, MAX_RECORDING_MS, type RecordingDriver } from '../audio/native-recorder';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { StoryHeading } from '../components/StoryPresentation';
import { usePdfPrivacy } from '../exports/PdfPrivacy';
import type { PrivatePdfStore } from '../exports/native-pdf';
import { accessibilityLanguages, type Language } from '../i18n';
import { useGuardedLeave } from '../navigation/useGuardedLeave';
import { colors, headingFont } from '../theme';
import { createRealSpeech, downloadRealExport, editRealDraft, exportRealDraft, findRealOperation, generateRealDraft, getRealCapabilities, getRealDraftHistory, getRealExports,
  getRealDraft, getRealDrafts, getRealMemories, getRealMessages, getRealOperation, getRealSpeechAudio, getRealTranscripts,
  RealAiError, reviewRealMemory, sendRealMessage, transcribeRealRecording,
  type RealCapabilities, type RealDraft, type RealExport, type RealMemory, type RealMessage, type RealScope, type RealTranscript,
  type SpeechMetadata } from './api';
import type { RealAiConfig } from './config';
import { realCopy } from './copy';
import { createRealPlayback, type RealPlayback } from './native-playback';
import { mediaPrivacy } from './media-privacy';

interface Props {
  language: Language; user: AuthUser; project: StoryProject; config: RealAiConfig;
  getAccessToken(expectedUserId: string): Promise<string | null>; onBack(): void; onSignOut(): void;
  initialTab?: 'chat' | 'memories' | 'book'; initialDraftId?: string;
}
type Pending = { key: string; operationId?: string; assistantId?: string; kind: 'transcription' | 'conversation' | 'generation' | 'speech' };
type Resource = 'transcripts' | 'messages' | 'memories' | 'drafts' | 'history' | 'exports';
type Pages = Record<Resource, number | null>;
const emptyPages = (): Pages => ({ transcripts: null, messages: null, memories: null, drafts: null, history: null, exports: null });
function appendUnique<T>(before: T[], added: T[], key: (value: T) => string): T[] {
  const ids = new Set(before.map(key)); return [...before, ...added.filter(item => !ids.has(key(item)))];
}
function ActionButton({ label, language, onPress, disabled = false, primary = false }: {
  label: string; language: Language; onPress(): void; disabled?: boolean; primary?: boolean;
}) {
  return <LargeButton language={language} density="compact" label={label} onPress={onPress}
    disabled={disabled} variant={primary ? 'primary' : 'secondary'} />;
}

/** Separate real contract. Legacy simulated parsers, UI and saved records remain untouched. */
export function RealStoryWorkspace(props: Props) {
  return <Workspace key={`${props.user.id}:${props.project.id}:${props.project.language}`} {...props} />;
}
function Workspace({ language, user, project, config, getAccessToken, onBack, onSignOut, initialTab = 'chat', initialDraftId }: Props) {
  const t = realCopy[language], locale = accessibilityLanguages[language], privacy = usePdfPrivacy();
  const [tab, setTab] = useState(initialTab), [capabilities, setCapabilities] = useState<RealCapabilities | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [transcripts, setTranscripts] = useState<RealTranscript[]>([]), [messages, setMessages] = useState<RealMessage[]>([]);
  const [memories, setMemories] = useState<RealMemory[]>([]), [drafts, setDrafts] = useState<RealDraft[]>([]);
  const [selected, setSelected] = useState<string | null>(initialDraftId ?? null);
  const [editor, setEditor] = useState<string | null>(null), [corrections, setCorrections] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<StoryEdit[] | null>(null), [notice, setNotice] = useState('');
  const [exports, setExports] = useState<RealExport[] | null>(null);
  const [recording, setRecording] = useState(false), [localRecording, setLocalRecording] = useState<AudioRecording | null>(null);
  const [duration, setDuration] = useState(0), [consent, setConsent] = useState(false), [generationConsent, setGenerationConsent] = useState(false);
  const [unresolved, setUnresolved] = useState<Pending | null>(null), [ambiguousEdit, setAmbiguousEdit] = useState(false);
  const [suspended, setSuspended] = useState(false), [playing, setPlaying] = useState(false);
  const [renewSpeech, setRenewSpeech] = useState(new Set<string>());
  const [pages, setPages] = useState<Pages>(emptyPages), [usageBlocked, setUsageBlocked] = useState(false);
  const mediaBlocked = useSyncExternalStore(mediaPrivacy.subscribe, mediaPrivacy.isBlocked, () => true);
  const mounted = useRef(false), active = useRef(false), epoch = useRef(0), locked = useRef(false);
  const controller = useRef<AbortController | null>(null), recorder = useRef<RecordingDriver | null>(null);
  const audio = useRef<AudioRecording | null>(null), capturing = useRef(false), playback = useRef<RealPlayback | null>(null);
  const pdfStore = useRef<PrivatePdfStore | null>(null), pending = useRef<Pending | null>(null);
  const speech = useRef(new Map<string, SpeechMetadata>()), latest = useRef({ onBack, onSignOut, privacy });
  const stopRecordingAction = useRef<() => void>(() => {});
  const draft = drafts.find(item => item.draft_id === selected) ?? drafts[0] ?? null;
  useLayoutEffect(() => { latest.current = { onBack, onSignOut, privacy }; });

  const releasePdf = () => { if (pdfStore.current) latest.current.privacy.release(pdfStore.current); pdfStore.current = null; };
  const cleanupAudio = () => {
    const previous = recorder.current; recorder.current = null; audio.current = null; capturing.current = false;
    if (previous) void mediaPrivacy.retire(previous);
    if (playback.current) void mediaPrivacy.retire(playback.current); playback.current = null;
    // Keep only owned synthesis IDs/expiry in this same-owner RAM view. Audio
    // files and prose are revoked; IDs allow a read-only replay after background.
    releasePdf();
  };
  const clearPrivate = () => {
    setTranscripts([]); setMessages([]); setMemories([]); setDrafts([]); setHistory(null); setExports(null);
    setEditor(null); setCorrections({}); setLocalRecording(null); setRecording(false); setDuration(0);
    setConsent(false); setGenerationConsent(false); setPlaying(false);
    setPages(emptyPages());
  };
  const scope = (signal: AbortSignal, id = sessionId): RealScope => {
    if (!id) throw new RealAiError('configuration');
    return { baseUrl: config.baseUrl, projectId: project.id, sessionId: id, language: project.language,
      getAccessToken: () => getAccessToken(user.id), signal };
  };
  const failureMessage = (error: unknown) => error instanceof StoryProjectsError
    ? error instanceof RealAiError && error.code === 'AI_USAGE_LIMIT' ? t.usageLimit : error.mayHaveWritten ? t.uncertain : error.kind === 'authentication' ? t.auth
      : error.kind === 'invalid-response' ? t.invalid : t.unavailable : t.audioFailure;
  async function run(action: (signal: AbortSignal, check: () => void) => Promise<void>, operation?: Pending) {
    if (!mounted.current || !active.current || locked.current) return;
    locked.current = true; setBusy(true); setNotice('');
    const stamp = epoch.current, abort = new AbortController(); controller.current = abort;
    if (operation) pending.current = operation;
    const check = () => { if (!mounted.current || !active.current || epoch.current !== stamp || abort.signal.aborted) throw new RealAiError('cancelled'); };
    try { await action(abort.signal, check); check(); if (operation) { pending.current = null; setUnresolved(null); } }
    catch (error) {
      if (mounted.current && active.current && epoch.current === stamp) {
        setNotice(failureMessage(error));
        if (error instanceof RealAiError && error.code === 'AI_USAGE_LIMIT') setUsageBlocked(true);
        if (error instanceof StoryProjectsError && error.mayHaveWritten) {
          if (operation) { const saved = { ...operation, operationId: error instanceof RealAiError ? error.operationId : undefined };
            setUnresolved(saved); pending.current = saved; }
          else setAmbiguousEdit(true);
        } else if (operation) { pending.current = null; setUnresolved(null); }
        if (error instanceof StoryProjectsError && error.kind === 'authentication') { cleanupAudio(); clearPrivate(); }
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (epoch.current === stamp && mounted.current) { locked.current = false; setBusy(false); }
    }
  }
  async function refresh(signal: AbortSignal, check: () => void, id: string) {
    const current = scope(signal, id);
    const result = await Promise.all([getRealTranscripts(current), getRealMessages(current), getRealMemories(current), getRealDrafts(current)]);
    const nextPages = { ...emptyPages(), transcripts: result[0].length === 100 ? 100 : null, messages: result[1].length === 100 ? 100 : null,
      memories: result[2].length === 100 ? 100 : null, drafts: result[3].length === 100 ? 100 : null };
    // A native share return can select an older version outside the newest page.
    if (selected && !result[3].some(item => item.draft_id === selected)) {
      const savedSelection = await getRealDraft(current, selected); check(); result[3].push(savedSelection);
    }
    check(); setTranscripts(result[0]); setMessages(result[1]); setMemories(result[2]); setDrafts(result[3]); setPages(nextPages);
  }
  const open = () => { void run(async (signal, check) => {
    const options = { baseUrl: config.baseUrl, getAccessToken: () => getAccessToken(user.id), signal };
    // These owned reads are independent. Keep continuation and private content
    // behind the same cancellation fence, without an extra serial round trip.
    const [caps, sessions] = await Promise.all([
      getRealCapabilities(options),
      listStorySessions({ ...options, projectId: project.id, expectedLanguage: project.language }),
    ]);
    check(); setCapabilities(caps);
    const existing = sessions.find(item => item.status === 'active');
    // The same canonical atomic Continue contract is used by the verified mobile flow.
    const id = existing?.id ?? (await continueStoryProject({ ...options, projectId: project.id, expectedLanguage: project.language })).session.id;
    check(); setSessionId(id); await refresh(signal, check, id); check(); setSuspended(false); setAmbiguousEdit(false);
  }); };
  useEffect(() => {
    const ownedSpeechMetadata = speech.current;
    mounted.current = true; active.current = AppState.currentState === 'active';
    if (active.current) open();
    const listener = AppState.addEventListener('change', state => {
      active.current = state === 'active';
      if (!active.current) {
        epoch.current++; controller.current?.abort(); locked.current = false; cleanupAudio(); clearPrivate();
        setBusy(false); setSuspended(true); setNotice('');
        // Retain only an operation ID for same-owner reconciliation, never audio or story wording.
        if (pending.current) setUnresolved(pending.current);
      }
    });
    // Read the latest generation counter intentionally: this is a cancellation fence, not a mounted native element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; active.current = false; epoch.current++; controller.current?.abort();
      cleanupAudio(); pending.current = null; ownedSpeechMetadata.clear(); listener.remove(); };
    // This component is keyed by verified owner/project/language. Configuration is fixed at entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkSaved = () => {
    if (!sessionId) { open(); return; }
    void run(async (signal, check) => {
      if (pending.current) {
        const state = pending.current.operationId ? await getRealOperation(scope(signal), pending.current.operationId)
          : await findRealOperation(scope(signal), pending.current.kind, pending.current.key); check();
        if (state.kind !== pending.current?.kind) throw new RealAiError('invalid-response');
        if (pending.current) pending.current.operationId = state.operation_id;
        if (state.status === 'in_progress' || state.status === 'uncertain') { setNotice(t.operationPending); return; }
        if (state.status === 'completed' && state.kind === 'speech') {
          if (!state.result || state.result.assistant_message_id !== pending.current?.assistantId) throw new RealAiError('invalid-response');
          speech.current.set(state.result.assistant_message_id, state.result);
          if (Date.parse(state.result.expires_at) <= Date.now()) setRenewSpeech(previous => new Set(previous).add(state.result!.assistant_message_id));
        }
        if (state.status === 'completed' && audio.current && recorder.current) {
          await recorder.current.discard(audio.current); check(); audio.current = null; setLocalRecording(null); setConsent(false);
        }
      }
      await refresh(signal, check, sessionId); check(); pending.current = null; setUnresolved(null);
      setAmbiguousEdit(false); setEditor(null); setNotice(t.saved);
    });
  };
  const discardAudio = () => {
    if (!audio.current || !recorder.current || busy || unresolved) return;
    void run(async (_signal, check) => {
      await recorder.current!.discard(audio.current!); check(); audio.current = null; setLocalRecording(null); setConsent(false);
    });
  };
  const stopCapture = () => {
    if (!capturing.current || !recorder.current || locked.current) return;
    capturing.current = false; setRecording(false);
    void run(async (_signal, check) => {
      const recorded = await recorder.current!.stop(); check(); audio.current = recorded;
      setLocalRecording(recorded); setDuration(recorded.durationMs); setConsent(false);
    });
  };
  useLayoutEffect(() => { stopRecordingAction.current = stopCapture; });
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      if (!active.current || !capturing.current || !recorder.current) return;
      try {
        const status = recorder.current.getStatus(); setDuration(status.durationMs);
        if (status.interrupted || !status.isRecording || status.durationMs >= MAX_RECORDING_MS) stopRecordingAction.current();
      } catch { stopRecordingAction.current(); }
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);
  const startCapture = () => {
    if (!capabilities?.transcription || audio.current || unresolved || ambiguousEdit || usageBlocked || mediaPrivacy.isBlocked()) return;
    void run(async (_signal, check) => {
      if (playback.current) await playback.current.stop(); check(); setPlaying(false);
      recorder.current ??= createNativeRecorder();
      const allowed = await recorder.current.requestPermission(); check();
      if (!allowed) { setNotice(t.permission); return; }
      await recorder.current.start(); check(); capturing.current = true; setRecording(true); setDuration(0);
    });
  };
  const upload = () => {
    if (!audio.current || !consent || !capabilities?.transcription || unresolved || ambiguousEdit || usageBlocked) return;
    const captured = audio.current, key = createRecordingId();
    void run(async (signal, check) => {
      const result = await transcribeRealRecording(scope(signal), captured, true, key); check();
      setTranscripts(previous => [result, ...previous.filter(item => item.transcript_id !== result.transcript_id)]);
      await recorder.current?.discard(captured); check(); audio.current = null; setLocalRecording(null); setConsent(false); setNotice(t.saved);
    }, { key, kind: 'transcription' });
  };
  const ask = (transcript: RealTranscript) => {
    if (!capabilities?.conversation || unresolved || ambiguousEdit || recording || localRecording || usageBlocked) return;
    const key = createRecordingId();
    void run(async (signal, check) => {
      const result = await sendRealMessage(scope(signal), { source_transcript_id: transcript.transcript_id }, key); check();
      setMessages(previous => [...previous, result.user_message, result.message].sort((a, b) => a.sequence - b.sequence));
      setMemories(previous => [...previous, ...result.memories]);
    }, { key, kind: 'conversation' });
  };
  const speak = (message: RealMessage) => {
    if (!capabilities?.speech || unresolved || recording || localRecording || ambiguousEdit || usageBlocked || mediaPrivacy.isBlocked()) return;
    const renewing = renewSpeech.has(message.id);
    const cached = renewing ? undefined : speech.current.get(message.id), key = createRecordingId();
    void run(async (signal, check) => {
      if (playback.current) await playback.current.stop(); check(); setPlaying(false);
      const current = scope(signal);
      // Replays use the same owned cached synthesis. Expiry never triggers an automatic paid synthesis.
      if (cached && Date.parse(cached.expires_at) <= Date.now()) { setRenewSpeech(previous => new Set(previous).add(message.id)); setNotice(t.voiceExpired); return; }
      const metadata = cached ?? await createRealSpeech(current, message.id, key); check();
      speech.current.set(message.id, metadata);
      setRenewSpeech(previous => { const next = new Set(previous); next.delete(message.id); return next; });
      let bytes: Uint8Array;
      try { bytes = await getRealSpeechAudio(current, metadata); }
      catch (error) { check(); if (error instanceof RealAiError && error.status === 410) {
        setRenewSpeech(previous => new Set(previous).add(message.id)); setNotice(t.voiceExpired); return;
      } throw error; }
      try {
        check(); playback.current ??= createRealPlayback();
        await playback.current.play(bytes, () => { if (mounted.current && active.current) setPlaying(false); }); check(); setPlaying(true);
      } finally { bytes.fill(0); }
    }, cached ? undefined : { key, kind: 'speech', assistantId: message.id });
  };
  const stopVoice = () => {
    if (!playback.current) return;
    // Stop is always available, including while a separate request is pending.
    void playback.current.stop().then(() => { if (mounted.current && active.current) setPlaying(false); },
      () => { if (mounted.current && active.current) setNotice(t.audioFailure); });
  };
  const review = (memory: RealMemory, status: 'confirmed' | 'rejected') => {
    if (unresolved || ambiguousEdit) return;
    const correction = status === 'confirmed' ? corrections[memory.id]?.trim() : undefined;
    void run(async (signal, check) => {
      const result = await reviewRealMemory(scope(signal), memory, status, correction || undefined); check();
      setMemories(previous => previous.map(item => item.id === result.id ? result : item));
      setCorrections(previous => { const next = { ...previous }; delete next[memory.id]; return next; });
      setNotice(t.saved);
    });
  };
  const generate = () => {
    if (!capabilities?.writing || !generationConsent || unresolved || ambiguousEdit || usageBlocked || !memories.some(item => item.status === 'confirmed')) return;
    const key = createRecordingId();
    void run(async (signal, check) => { const result = await generateRealDraft(scope(signal), key); check();
      setDrafts(previous => [result, ...previous]); setSelected(result.draft_id); setHistory(null); setGenerationConsent(false);
    }, { key, kind: 'generation' });
  };
  const saveEdit = () => {
    if (!draft || editor === null || unresolved || ambiguousEdit) return;
    const before = draft, content = editor;
    void run(async (signal, check) => { const result = await editRealDraft(scope(signal), before, content); check();
      setDrafts(previous => previous.map(item => item.draft_id === result.draft_id ? result : item)); setEditor(null); setHistory(null); setNotice(t.saved);
    });
  };
  const showHistory = () => { if (draft) void run(async (signal, check) => {
    const items = await getRealDraftHistory(scope(signal), draft.draft_id); check(); setHistory(items); setPages(previous => ({ ...previous, history: items.length === 100 ? 100 : null }));
  }); };
  const sharePdf = () => {
    if (!draft || editor !== null || !privacy.ready || privacy.failed || unresolved || ambiguousEdit || busy) return;
    const captured = draft;
    void run(async (signal, check) => {
      releasePdf(); const store = latest.current.privacy.createStore(user.id); pdfStore.current = store;
      try {
        const bytes = await exportRealDraft(scope(signal), captured);
        let handle;
        try { check(); handle = await store.save(bytes); check(); } finally { bytes.fill(0); }
        latest.current.privacy.rememberReturn(user.id, project.id, captured.draft_id);
        await store.share(handle); check();
        await store.discard(handle); check();
      } finally { latest.current.privacy.release(store); if (pdfStore.current === store) pdfStore.current = null; }
    });
  };
  const showExports = () => { void run(async (signal, check) => {
    const items = await getRealExports(scope(signal)); check(); setExports(items); setPages(previous => ({ ...previous, exports: items.length === 100 ? 100 : null }));
  }); };
  const shareSavedPdf = (metadata: RealExport) => {
    if (!privacy.ready || privacy.failed || unresolved || ambiguousEdit || busy || editor !== null) return;
    void run(async (signal, check) => {
      releasePdf(); const store = latest.current.privacy.createStore(user.id); pdfStore.current = store;
      try {
        const bytes = await downloadRealExport(scope(signal), metadata);
        let handle;
        try { check(); handle = await store.save(bytes); check(); } finally { bytes.fill(0); }
        latest.current.privacy.rememberReturn(user.id, project.id, metadata.draft_id);
        await store.share(handle); check(); await store.discard(handle); check();
      } finally { latest.current.privacy.release(store); if (pdfStore.current === store) pdfStore.current = null; }
    });
  };
  const loadMore = (resource: Resource) => {
    const offset = pages[resource]; if (offset === null || offset >= 1000 || busy) return;
    void run(async (signal, check) => {
      const current = scope(signal); let count = 0;
      if (resource === 'transcripts') { const items = await getRealTranscripts(current, offset); check(); count = items.length; setTranscripts(previous => appendUnique(previous, items, item => item.transcript_id)); }
      if (resource === 'messages') { const items = await getRealMessages(current, offset); check(); count = items.length; setMessages(previous => appendUnique(previous, items, item => item.id).sort((a, b) => a.sequence - b.sequence)); }
      if (resource === 'memories') { const items = await getRealMemories(current, offset); check(); count = items.length; setMemories(previous => appendUnique(previous, items, item => item.id)); }
      if (resource === 'drafts') { const items = await getRealDrafts(current, offset); check(); count = items.length; setDrafts(previous => appendUnique(previous, items, item => item.draft_id).sort((a, b) => b.version - a.version)); }
      if (resource === 'history' && draft) { const items = await getRealDraftHistory(current, draft.draft_id, offset); check(); count = items.length; setHistory(previous => appendUnique(previous ?? [], items, item => item.id)); }
      if (resource === 'exports') { const items = await getRealExports(current, offset); check(); count = items.length; setExports(previous => appendUnique(previous ?? [], items, item => item.export_id)); }
      check(); setPages(previous => ({ ...previous, [resource]: count === 100 ? offset + 100 : null }));
    });
  };
  const dirty = !!localRecording || recording || (editor !== null && editor !== draft?.content) || Object.values(corrections).some(Boolean);
  const leave = useGuardedLeave({ language, dirty, uncertain: !!unresolved || ambiguousEdit || busy,
    onDiscard: () => { epoch.current++; controller.current?.abort(); cleanupAudio();
      locked.current = false; setBusy(false); setEditor(null); setCorrections({}); setLocalRecording(null);
      setRecording(false); setConsent(false); setPlaying(false); },
    onCheckSavedResult: checkSaved, checkDisabled: busy || !sessionId });
  const navigate = (next: typeof tab) => { if (tab !== next) leave.requestLeave(() => {
    stopVoice(); setEditor(null); setCorrections({}); setTab(next);
  }); };
  const { requestLeave } = leave;
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { requestLeave(() => latest.current.onBack()); return true; });
    return () => listener.remove();
  }, [requestLeave]);
  const blocked = busy || suspended || !!unresolved || ambiguousEdit || recording || !!localRecording || mediaBlocked;
  const actionDefaults = { language, disabled: blocked };
  const note = (value: string) => <Text allowFontScaling accessibilityLanguage={locale} style={styles.note}>{value}</Text>;
  const checkbox = (label: string, checked: boolean, action: () => void, disabled: boolean) => <Pressable accessibilityRole="checkbox"
    accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={action} style={styles.checkbox}>
    <Text allowFontScaling accessibilityLanguage={locale} style={styles.body}>{checked ? '☑' : '☐'} {label}</Text></Pressable>;
  return <Screen working keyboardAware><View style={styles.workspace}>
    <StoryHeading kicker={t.eyebrow} title={project.title} language={language} storyLanguage={project.language} />
    <Text allowFontScaling style={styles.badge}>{t.real} · {project.language === 'sv' ? 'Svenska' : 'English'}</Text>
    {note(t.pending)}
    {notice !== '' && <Text allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    {usageBlocked && note(t.usageLimit)}
    {mediaBlocked && <View style={styles.card}>{note(t.cleanupBlocked)}<ActionButton language={language} label={t.retryCleanup}
      onPress={() => { void mediaPrivacy.retry(); }} /></View>}
    {suspended ? <>{note(t.background)}<ActionButton {...actionDefaults} label={t.resume} onPress={open} disabled={busy} primary /></> : <>
      {!capabilities && note(t.loading)}
      {capabilities && !capabilities.enabled && <View style={styles.card}>{note(t.disabled)}</View>}
      <View style={styles.tabs}>{(['chat', 'memories', 'book'] as const).map(item => <Pressable key={item} accessibilityRole="tab"
        accessibilityState={{ selected: tab === item, disabled: busy }} disabled={busy} onPress={() => navigate(item)}
        style={[styles.tab, tab === item && styles.selectedTab]}><Text allowFontScaling style={styles.tabText}>{t[item]}</Text></Pressable>)}</View>
      {tab === 'chat' && <>
        {note(t.introduction)}
        <View style={styles.thread} testID="real-ai-chat-thread">
          {!messages.length && note(t.noMessages)}
          {messages.map(message => <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text allowFontScaling style={styles.speaker}>{message.role === 'user' ? t.you : t.assistant}</Text>
            {message.role === 'user' && note(t.original)}
            <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.body}>{message.text}</Text>
            {message.role === 'assistant' && <>{note(t.voice)}<ActionButton {...actionDefaults} label={renewSpeech.has(message.id) ? t.renewSpeech : t.speak} onPress={() => speak(message)} disabled={blocked || usageBlocked || !capabilities?.speech} /></>}
          </View>)}
        </View>
        {transcripts.filter(source => !messages.some(message => message.source_transcript_id === source.transcript_id)).map(source => <View key={source.transcript_id} style={styles.card}>
          <Text allowFontScaling style={styles.speaker}>{t.original}</Text>
          <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.body}>{source.text}</Text>
          <ActionButton {...actionDefaults} label={t.process} onPress={() => ask(source)} disabled={blocked || usageBlocked || !capabilities?.conversation} primary />
        </View>)}
        {playing && <ActionButton {...actionDefaults} label={t.stopVoice} onPress={stopVoice} disabled={false} primary />}
        <View style={styles.composer}>
          {recording ? <><Text allowFontScaling accessibilityLiveRegion="polite" style={styles.speaker}>{t.recording} · {Math.floor(duration / 1000)}s / 60s</Text>
            <ActionButton {...actionDefaults} label={t.stop} onPress={stopCapture} disabled={busy} primary /></>
            : localRecording ? <>{note(t.recorded)}
              {checkbox(t.consent, consent, () => setConsent(!consent), busy || !!unresolved)}
              <ActionButton {...actionDefaults} label={t.transcribe} onPress={upload} disabled={busy || !!unresolved || usageBlocked || !consent || !capabilities?.transcription} primary />
              <ActionButton {...actionDefaults} label={t.discard} onPress={discardAudio} disabled={busy || !!unresolved} />
            </> : <ActionButton {...actionDefaults} label={t.start} onPress={startCapture} disabled={blocked || usageBlocked || !sessionId || !capabilities?.transcription} primary />}
        </View>
      </>}
      {tab === 'memories' && <>
        {note(t.reviewNotice)}{!memories.length && note(t.emptyMemories)}
        {memories.map(memory => <View key={memory.id} style={styles.card}>
          <Text allowFontScaling style={styles.speaker}>{memory.status === 'pending' ? t.pendingStatus : memory.status === 'confirmed' ? t.confirmed : t.rejected}</Text>
          <Text allowFontScaling selectable style={styles.body}>{memory.corrected_value ?? memory.value}</Text>
          <Text allowFontScaling style={styles.sourceLabel}>{t.evidence}</Text>
          <Text allowFontScaling selectable style={styles.quote}>{memory.evidence}</Text>
          {memory.clarification_question && <>{note(t.question)}<Text allowFontScaling style={styles.body}>{memory.clarification_question}</Text></>}
          <TextInput accessibilityLabel={t.correct} placeholder={t.correct} value={corrections[memory.id] ?? ''} multiline maxLength={1000}
            editable={!blocked} style={styles.input} onChangeText={value => { if (!busy && active.current) setCorrections(previous => ({ ...previous, [memory.id]: value })); }} />
          <ActionButton {...actionDefaults} label={t.confirm} onPress={() => review(memory, 'confirmed')} primary />
          <ActionButton {...actionDefaults} label={t.reject} onPress={() => review(memory, 'rejected')} />
        </View>)}
      </>}
      {tab === 'book' && <>
        {drafts.length > 1 && <View style={styles.card}>{drafts.map(item => <ActionButton key={item.draft_id} {...actionDefaults}
          label={`${t.version} ${item.version} · ${t.revision} ${item.revision}`}
          onPress={() => leave.requestLeave(() => { setSelected(item.draft_id); setEditor(null); setHistory(null); })} disabled={blocked || editor !== null} />)}</View>}
        {!draft && note(t.emptyBook)}
        {draft && <View style={styles.card}>
          <Text allowFontScaling style={styles.bookTitle}>{project.title}</Text>
          {note(`${t.version} ${draft.version} · ${t.revision} ${draft.revision}`)}
          {note(t.reviewDraft)}{note(t.modelReview)}
          {draft.verification.status === 'stale_sources' && note(t.stale)}
          {editor === null ? <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.bookProse}>{draft.content}</Text>
            : <><Text allowFontScaling style={styles.speaker}>{t.editor}</Text><TextInput accessibilityLabel={t.editor} value={editor}
              multiline maxLength={20_000} editable={!busy && !ambiguousEdit} style={[styles.input, styles.editor]}
              onChangeText={value => { if (!busy && active.current) setEditor(value); }} />
              <ActionButton {...actionDefaults} label={t.save} onPress={saveEdit} disabled={blocked || !editor.trim() || editor === draft.content} primary />
              <ActionButton {...actionDefaults} label={t.cancel} onPress={() => leave.requestLeave(() => setEditor(null))} disabled={busy} />
            </>}
          {editor === null && <><ActionButton {...actionDefaults} label={t.edit} onPress={() => { setEditor(draft.content); setHistory(null); }} />
            <ActionButton {...actionDefaults} label={t.history} onPress={showHistory} />
            <ActionButton {...actionDefaults} label={t.export} onPress={sharePdf} disabled={blocked || !privacy.ready || privacy.failed} primary />{note(t.pdfNotice)}</>}
          <Text allowFontScaling style={styles.speaker}>{t.sources}</Text>
          {draft.source_memories.map(source => <View key={source.memory_id} style={styles.source}><Text allowFontScaling style={styles.body}>{source.corrected_value ?? source.value}</Text>
            <Text allowFontScaling selectable style={styles.quote}>{source.evidence}</Text></View>)}
          {history && <View style={styles.source}>{!history.length && note(t.noHistory)}{history.map(item => <View key={item.id}>
            {note(`${t.revision} ${item.revision}`)}<Text allowFontScaling selectable style={styles.body}>{item.content}</Text></View>)}</View>}
        </View>}
        {checkbox(t.generationConsent, generationConsent, () => setGenerationConsent(!generationConsent), blocked || editor !== null)}
        <ActionButton {...actionDefaults} label={t.generate} onPress={generate} disabled={blocked || usageBlocked || editor !== null || !generationConsent || !capabilities?.writing || !memories.some(item => item.status === 'confirmed')} primary />
        <ActionButton {...actionDefaults} label={t.exports} onPress={showExports} disabled={blocked || editor !== null} />
        {exports && <View style={styles.card}>{!exports.length && note(t.noExports)}{exports.map(item => <View key={item.export_id} style={styles.source}>
          <Text allowFontScaling style={styles.speaker}>{item.title}</Text>
          {note(`${t.version} ${item.draft_version} · ${t.revision} ${item.draft_revision}`)}
          <ActionButton {...actionDefaults} label={t.download} onPress={() => shareSavedPdf(item)} disabled={blocked || editor !== null || !privacy.ready || privacy.failed} />
        </View>)}</View>}
      </>}
      {(Object.keys(pages) as Resource[]).filter(resource => pages[resource] !== null &&
        (tab === 'chat' ? ['transcripts', 'messages'].includes(resource) : tab === 'memories' ? resource === 'memories' : ['drafts', 'history', 'exports'].includes(resource))).map(resource =>
        <View key={resource} style={styles.card}>{note(`${t.moreSaved}: ${t[resource]}`)}
          {(pages[resource] ?? 0) >= 1000 ? note(t.pageLimit) : <ActionButton {...actionDefaults} label={`${t.loadMore}: ${t[resource]}`} onPress={() => loadMore(resource)} disabled={blocked || editor !== null} />}
        </View>)}
      {(unresolved || ambiguousEdit) && <ActionButton {...actionDefaults} label={t.check} onPress={checkSaved} disabled={busy || recording || !sessionId} primary />}
      <ActionButton {...actionDefaults} label={t.reload} onPress={() => { if (unresolved || ambiguousEdit) checkSaved(); else open(); }} disabled={busy || recording || !!localRecording || editor !== null} />
    </>}
    {busy && <Text accessibilityLiveRegion="polite" style={styles.note}>{t.busy}</Text>}
    <ActionButton {...actionDefaults} label={t.back} onPress={() => leave.requestLeave(() => latest.current.onBack())} disabled={false} />
    <ActionButton {...actionDefaults} label={t.signOut} onPress={() => leave.requestLeave(() => latest.current.onSignOut())} disabled={false} />
    {leave.dialog}
  </View></Screen>;
}
const styles = StyleSheet.create({
  workspace: { width: '100%', gap: 20 }, badge: { color: colors.forest, fontSize: 16, lineHeight: 25, fontWeight: '600', textAlign: 'center' },
  note: { color: colors.muted, fontSize: 17, lineHeight: 27, flexShrink: 1 }, notice: { color: colors.ink, backgroundColor: colors.selected, padding: 16, borderRadius: 16, fontSize: 18, lineHeight: 28 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tab: { minHeight: 56, padding: 12, borderRadius: 16, borderColor: colors.border, borderWidth: 1, justifyContent: 'center', flexGrow: 1 },
  selectedTab: { backgroundColor: colors.selected, borderColor: colors.forest }, tabText: { color: colors.forest, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  card: { gap: 16, backgroundColor: colors.paper, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  thread: { gap: 16 }, bubble: { maxWidth: '96%', gap: 12, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.selected, borderBottomRightRadius: 6 },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.paper, borderBottomLeftRadius: 6 },
  speaker: { fontSize: 17, lineHeight: 26, fontWeight: '600', color: colors.forest }, body: { color: colors.ink, fontSize: 21, lineHeight: 33 },
  composer: { gap: 16, backgroundColor: colors.paper, padding: 20, borderRadius: 24, borderColor: colors.border, borderWidth: 1 },
  checkbox: { minHeight: 56, paddingVertical: 8 }, sourceLabel: { fontSize: 16, color: colors.muted },
  quote: { fontSize: 18, lineHeight: 29, color: colors.muted, borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 12 },
  input: { color: colors.ink, fontSize: 21, lineHeight: 33, minHeight: 80, textAlignVertical: 'top', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.forest, backgroundColor: colors.cream },
  editor: { minHeight: 320 }, bookTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 32, lineHeight: 42 },
  bookProse: { color: colors.ink, fontFamily: headingFont, fontSize: 22, lineHeight: 36 }, source: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderColor: colors.border },
});
