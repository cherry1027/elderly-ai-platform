import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { AppState, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { AuthUser } from '../auth/client';
import { continueStoryProject, listStorySessions, StoryProjectsError, type StoryProject } from '../api/story-projects';
import type { AudioRecording } from '../api/audio-transcripts';
import type { StoryEdit } from '../api/story-drafts';
import { createNativeRecorder, createRecordingId, MAX_RECORDING_MS, type RecordingDriver } from '../audio/native-recorder';
import { RecordingWakeLock } from '../audio/RecordingWakeLock';
import { LargeButton } from '../components/LargeButton';
import { AccountAction } from '../components/AccountPresentation';
import { Screen } from '../components/Screen';
import { StoryDisclosure, StoryHeading } from '../components/StoryPresentation';
import { usePdfPrivacy } from '../exports/PdfPrivacy';
import type { PrivatePdfStore } from '../exports/native-pdf';
import { accessibilityLanguages, type Language } from '../i18n';
import { useGuardedLeave } from '../navigation/useGuardedLeave';
import { colors, layout } from '../theme';
import { createRealSpeech, downloadRealExport, editRealDraft, exportRealDraft, findRealOperation, generateRealDraft, getRealCapabilities, getRealDraftHistory, getRealExports,
  getRealDraft, getRealDrafts, getRealMemories, getRealMessages, getRealOperation, getRealSpeechAudio, getPreparedRealSpeech, getRealTranscripts,
  RealAiError, decodeRealTextTurn, hashRealText, reviewRealMemory, saveRealMemoryFromMessage, sendRealMessage, sendRealTextMessage, transcribeRealRecording,
  type RealCapabilities, type RealDraft, type RealExport, type RealMemory, type RealMessage, type RealScope, type RealTranscript, type RealTurn,
  type SpeechMetadata, type RealConversationProgress } from './api';
import type { RealAiConfig } from './config';
import { realCopy } from './copy';
import { createRealPlayback, RealPlaybackError, type RealPlayback } from './native-playback';
import { conversationModeCopy, readConversationMode, saveConversationMode, type ConversationMode } from './conversation-mode';
import { mediaPrivacy } from './media-privacy';
import { MemoriesContent, AutobiographyContent, SavedWordsContent, isSavedMessageMemory, storyContentCopy } from './StoryContent';
import { NavigationIcon } from '../components/NavigationIcon';
import { ChatMessageHistory } from './ChatMessageHistory';
import { VoiceAction, VoiceRecordingControls } from './VoiceRecordingControls';
import { SpeechBytesCache } from './speech-bytes-cache';
import { OriginalWordsEvidence } from './OriginalWordsEvidence';

interface Props {
  language: Language; user: AuthUser; project: StoryProject; config: RealAiConfig;
  getAccessToken(expectedUserId: string): Promise<string | null>; onBack(): void; onSignOut(): void;
  initialTab?: 'chat' | 'memories' | 'book'; initialDraftId?: string; onAuthenticationFailure?(): void; onStoryDetails?(): void;
}
type Pending = { key: string; operationId?: string; assistantId?: string; inputType?: 'typed'; textDigest?: string; voice?: true; voiceTranscriptId?: string; kind: 'transcription' | 'conversation' | 'generation' | 'speech' };
type Activity = 'recording' | 'speech' | 'story' | 'pdf' | 'checking' | 'saving';
type TypedOutbox = { key: string; text: string };
type Resource = 'transcripts' | 'messages' | 'memories' | 'drafts' | 'history' | 'exports';
type Pages = Record<Resource, number | null>;
type ReadState = { loaded: boolean; loading: boolean; error: string };
const emptyReads = (): Record<Resource, ReadState> => Object.fromEntries(
  ['transcripts', 'messages', 'memories', 'drafts', 'history', 'exports'].map(name => [name, { loaded: false, loading: false, error: '' }]),
) as Record<Resource, ReadState>;
function knownFreeSpeechExpiry(error: unknown): error is RealAiError {
  return error instanceof RealAiError && error.kind === 'not-found' && error.status === 410 && error.code === 'SPEECH_EXPIRED' &&
    !error.mayHaveWritten && !error.operationId && error.recovery === undefined;
}
const emptyPages = (): Pages => ({ transcripts: null, messages: null, memories: null, drafts: null, history: null, exports: null });
function appendUnique<T>(before: T[], added: T[], key: (value: T) => string): T[] {
  const ids = new Set(before.map(key)); return [...before, ...added.filter(item => !ids.has(key(item)))];
}
function ActionButton({ label, language, onPress, disabled = false, primary = false }: {
  label: string; language: Language; onPress(): void; disabled?: boolean; primary?: boolean;
}) {
  return <LargeButton language={language} density="compact" label={label} onPress={onPress}
    disabled={disabled} variant={primary ? 'primary' : 'tertiary'} />;
}

/** Familiar icons reuse the app's installed SVG renderer; labels remain native. */
function SendAction({ language, label, onPress, disabled }: {
  language: Language; label: string; onPress(): void; disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { if (!disabled) onPress(); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.composerAction, styles.sendAction,
      pressed && !disabled && styles.actionPressed, focused && styles.actionFocused, disabled && styles.actionDisabled]}>
    <Svg width={26} height={26} viewBox="0 0 24 24" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={12} cy={12} r={10} fill="none" stroke={colors.paper} strokeWidth={1.8} />
      <Path d="M12 17V7 M8 11l4-4 4 4" fill="none" stroke={colors.paper} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </Pressable>;
}

/** Presentation only: no capability/configuration details are inferred here. */
function AvailabilityNotice({ language }: { language: Language }) {
  const [expanded, setExpanded] = useState(false), [focused, setFocused] = useState(false);
  const t = realCopy[language], locale = accessibilityLanguages[language];
  return <View testID="ai-availability-banner" style={styles.availability}>
    <View style={styles.availabilitySummary}>
      <Text allowFontScaling accessibilityLanguage={locale} style={styles.availabilityText}>{t.disabled}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t.details} accessibilityLanguage={locale}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.availabilityDetails, pressed && styles.availabilityPressed, focused && styles.actionFocused]}>
        <Text allowFontScaling style={styles.availabilityLabel}>{t.details}</Text>
      </Pressable>
    </View>
    {expanded && <Text allowFontScaling accessibilityLanguage={locale} style={styles.availabilityExplanation}>{t.disabledDetails}</Text>}
  </View>;
}

/** Separate real contract. Legacy simulated parsers, UI and saved records remain untouched. */
export function RealStoryWorkspace(props: Props) {
  return <Workspace key={`${props.user.id}:${props.project.id}:${props.project.language}`} {...props} />;
}
function Workspace({ language, user, project, config, getAccessToken, onBack, onSignOut, initialTab = 'chat', initialDraftId, onAuthenticationFailure, onStoryDetails }: Props) {
  const t = realCopy[language], locale = accessibilityLanguages[language], privacy = usePdfPrivacy();
  const contentScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const conversationCopy = conversationModeCopy[language], storyCopy = storyContentCopy[language];
  // Undefined is still loading, null is a first visit, and a mode is a saved choice.
  const [preferredMode, setPreferredMode] = useState<ConversationMode | null>();
  const mode = preferredMode ?? 'write';
  const modeRef = useRef<ConversationMode | null>(null);
  const nextSpokenReply = useRef<RealMessage | null>(null);
  useEffect(() => {
    let open = true;
    void readConversationMode().then(saved => {
      if (!open || modeRef.current !== null) return;
      modeRef.current = saved;
      setPreferredMode(saved);
    });
    return () => { open = false; };
  }, []);
  const [tab, setTab] = useState(initialTab), [capabilities, setCapabilities] = useState<RealCapabilities | null>(null);
  const [savedWordsOpen, setSavedWordsOpen] = useState(false);
  const [finishRequested, setFinishRequested] = useState(false);
  useEffect(() => { contentScroll.current?.scrollTo({ y: 0, animated: false }); }, [tab]);
  const [readStates, setReadStates] = useState(emptyReads), [opening, setOpening] = useState(false);
  const [continuationBusy, setContinuationBusy] = useState(false), [authenticationFailed, setAuthenticationFailed] = useState(false);
  const reads = useRef(emptyReads()), readJobs = useRef(new Map<Resource, { controller: AbortController; promise: Promise<void> }>());
  const readTickets = useRef<Record<Resource, number>>({ transcripts: 0, messages: 0, memories: 0, drafts: 0, history: 0, exports: 0 });
  const bootstrap = useRef<AbortController | null>(null), authenticationBlocked = useRef(false), continuing = useRef(false);
  const session = useRef<string | null>(null), currentSection = useRef(initialTab), chosenDraft = useRef<string | null>(initialDraftId ?? null);
  const currentDraft = useRef<RealDraft | null>(null), historyIdentity = useRef('');
  const editingDraft = useRef<RealDraft | null>(null), correctionBases = useRef(new Map<string, RealMemory>());
  const historyCache = useRef(new Map<string, { items: StoryEdit[]; page: number | null }>());
  const [sessionId, setSessionId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [transcripts, setTranscripts] = useState<RealTranscript[]>([]), [messages, setMessages] = useState<RealMessage[]>([]);
  const [memories, setMemories] = useState<RealMemory[]>([]), [drafts, setDrafts] = useState<RealDraft[]>([]);
  const [selected, setSelected] = useState<string | null>(initialDraftId ?? null);
  const [editor, setEditor] = useState<string | null>(null), [corrections, setCorrections] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<StoryEdit[] | null>(null), [notice, setNotice] = useState('');
  const [exports, setExports] = useState<RealExport[] | null>(null);
  const [recording, setRecording] = useState(false), [localRecording, setLocalRecording] = useState<AudioRecording | null>(null);
  const [duration, setDuration] = useState(0), [generationConsent, setGenerationConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false), [voiceReplySending, setVoiceReplySending] = useState(false);
  const [safeReplyId, setSafeReplyId] = useState<string | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const [unresolved, setUnresolved] = useState<Pending | null>(null), [ambiguousEdit, setAmbiguousEdit] = useState(false);
  const [suspended, setSuspended] = useState(false), [playing, setPlaying] = useState(false);
  const [renewSpeech, setRenewSpeech] = useState(new Set<string>());
  const [pages, setPages] = useState<Pages>(emptyPages), [usageBlocked, setUsageBlocked] = useState(false);
  const [serviceBlocked, setServiceBlocked] = useState(false);
  const [textDraft, setTextDraft] = useState(''), [textSending, setTextSending] = useState(false);
  const [outbox, setOutbox] = useState<TypedOutbox | null>(null), [activity, setActivity] = useState<Activity | null>(null);
  const [replyPreview, setReplyPreview] = useState<{ text: string; saving: boolean } | null>(null);
  const [latestReplyId, setLatestReplyId] = useState<string | null>(null), [replyAnchor, setReplyAnchor] = useState<{ id: string; y: number } | null>(null);
  const latestReply = useRef<string | null>(null), replyLayouts = useRef(new Map<string, number>());
  const scrollOffsets = useRef({ body: 0, workspace: 0, thread: 0 });
  const mediaBlocked = useSyncExternalStore(mediaPrivacy.subscribe, mediaPrivacy.isBlocked, () => true);
  const mounted = useRef(false), active = useRef(false), epoch = useRef(0), locked = useRef(false);
  const controller = useRef<AbortController | null>(null), recorder = useRef<RecordingDriver | null>(null);
  const audio = useRef<AudioRecording | null>(null), capturing = useRef(false), playback = useRef<RealPlayback | null>(null);
  const pdfStore = useRef<PrivatePdfStore | null>(null), pending = useRef<Pending | null>(null);
  const [speechBytes] = useState(() => new SpeechBytesCache());
  const speakCurrent = useRef<(message: RealMessage, automatic?: boolean) => void>(() => {});
  const onSpeak = useCallback((message: RealMessage) => speakCurrent.current(message), []);
  const speech = useRef(new Map<string, SpeechMetadata>()), latest = useRef({ onBack, onSignOut, privacy, onAuthenticationFailure, onStoryDetails });
  const stopRecordingAction = useRef<() => void>(() => {});
  const voiceConsent = useRef<string | null>(null), consentIntent = useRef<{ epoch: number; scope: string } | null>(null);
  const voiceContext = useRef({ capabilities, usageBlocked, sessionId });
  const voiceScope = () => `${user.id}:${project.id}:${project.language}:${voiceContext.current.sessionId}`;
  const placedTranscriptIds = useMemo(() => new Set(messages.map(message => message.source_transcript_id).filter(Boolean)), [messages]);
  const unplacedTranscripts = useMemo(() => transcripts.filter(source => !placedTranscriptIds.has(source.transcript_id)), [transcripts, placedTranscriptIds]);
  const draft = drafts.find(item => item.draft_id === selected) ?? drafts[0] ?? null;
  const hasOpenQuestions = memories.some(item => item.status === 'pending' && item.clarification_question);
  const hasConfirmedMemories = memories.some(item => item.status === 'confirmed');
  useLayoutEffect(() => { latest.current = { onBack, onSignOut, privacy, onAuthenticationFailure, onStoryDetails }; voiceContext.current = { capabilities, usageBlocked, sessionId };
    currentSection.current = tab; chosenDraft.current = selected; currentDraft.current = draft; });

  function clearLatestReply() { latestReply.current = null; setLatestReplyId(null); setReplyAnchor(null); }
  function presentReply(message: RealMessage) {
    latestReply.current = message.id; setLatestReplyId(message.id);
    const y = replyLayouts.current.get(message.id); setReplyAnchor(y === undefined ? null : { id: message.id, y });
  }
  const recordMessageLayout = useCallback((id: string, y: number) => {
    if (!mounted.current || !active.current || !Number.isFinite(y) || y < 0) return;
    if (!replyLayouts.current.has(id) && replyLayouts.current.size >= 1000) replyLayouts.current.delete(replyLayouts.current.keys().next().value!);
    replyLayouts.current.set(id, y);
    if (latestReply.current === id) setReplyAnchor(before => before?.id === id && before.y === y ? before : { id, y });
  }, []);
  function viewLatestReply() {
    const id = latestReply.current, y = id ? replyLayouts.current.get(id) : undefined;
    if (!mounted.current || !active.current || currentSection.current !== 'chat' || !id || y === undefined ||
      !messages.some(message => message.id === id && message.role === 'assistant' && message.session_id === sessionId && message.project_id === project.id) || !contentScroll.current) return;
    const offset = scrollOffsets.current, target = offset.body + offset.workspace + offset.thread + y;
    if (!Number.isFinite(target)) return;
    contentScroll.current.scrollTo({ y: Math.max(0, target), animated: false });
    clearLatestReply();
  }
  const releasePdf = () => { if (pdfStore.current) latest.current.privacy.release(pdfStore.current); pdfStore.current = null; };
  const cleanupAudio = () => {
    nextSpokenReply.current = null;
    speechBytes.clear();
    const previous = recorder.current; recorder.current = null; audio.current = null; capturing.current = false;
    if (previous) void mediaPrivacy.retire(previous);
    if (playback.current) void mediaPrivacy.retire(playback.current); playback.current = null;
    // Keep only owned synthesis IDs/expiry in this same-owner RAM view. Audio
    // files and prose are revoked; IDs allow a read-only replay after background.
    releasePdf();
  };
  function updateRead(resource: Resource, value: Partial<ReadState>) {
    reads.current = { ...reads.current, [resource]: { ...reads.current[resource], ...value } }; setReadStates(reads.current);
  }
  function cancelReads(publish = false) {
    for (const [resource, job] of readJobs.current) {
      job.controller.abort(); readTickets.current[resource]++;
      if (publish) updateRead(resource, { loading: false });
    }
    readJobs.current.clear();
  }
  const clearPrivate = () => {
    setReplyPreview(null);
    setOutbox(null); setActivity(null); clearLatestReply(); replyLayouts.current.clear();
    cancelReads(); bootstrap.current?.abort(); bootstrap.current = null; setOpening(false); setContinuationBusy(false);
    reads.current = emptyReads(); setReadStates(reads.current); historyCache.current.clear(); historyIdentity.current = '';
    setTranscripts([]); setMessages([]); setMemories([]); setDrafts([]); setHistory(null); setExports(null);
    currentDraft.current = null; editingDraft.current = null; correctionBases.current.clear(); setEditor(null); setCorrections({}); setLocalRecording(null); setRecording(false); setDuration(0);
    voiceConsent.current = null; consentIntent.current = null; setConsentOpen(false); setVoiceReplySending(false); setSafeReplyId(null);
    setGenerationConsent(false); setPlaying(false); setSavedWordsOpen(false); setFinishRequested(false);
    setTextDraft(''); setTextSending(false);
    setPages(emptyPages());
  };
  const scope = (signal: AbortSignal, id = sessionId): RealScope => {
    if (!id) throw new RealAiError('configuration');
    return { baseUrl: config.baseUrl, projectId: project.id, sessionId: id, language: project.language,
      getAccessToken: () => getAccessToken(user.id), signal };
  };
  const allowanceError = (error: unknown) => error instanceof RealAiError && ['AI_USAGE_LIMIT', 'AI_GLOBAL_BUDGET_EXHAUSTED', 'AI_USER_BUDGET_EXHAUSTED'].includes(error.code ?? '');
  const failureMessage = (error: unknown) => error instanceof RealAiError && error.kind === 'authentication' ? t.auth
    : error instanceof RealAiError && error.mayHaveWritten ? t.uncertain
    : error instanceof RealAiError && error.code === 'CLARIFICATION_REQUIRED' ? t.answerQuestions
    : error instanceof RealAiError && error.code === 'NO_CONFIRMED_MEMORIES' ? t.confirmFirst
    : allowanceError(error) ? t.usageLimit
    : error instanceof RealAiError && error.recovery === 'contact-operator' ? t.serviceUnavailable
    : error instanceof RealAiError && (error.recovery === 'wait' || error.retry) ? t.serviceBusy
    : error instanceof RealAiError && error.code === 'TEXT_CHAT_NOT_READY' && !error.mayHaveWritten ? t.textNotReady : error instanceof StoryProjectsError
    ? error instanceof RealAiError && error.code === 'AI_USAGE_LIMIT' ? t.usageLimit : error.mayHaveWritten ? t.uncertain : error.kind === 'authentication' ? t.auth
      : error.kind === 'invalid-response' ? t.invalid : t.unavailable : t.audioFailure;
  async function run(action: (signal: AbortSignal, check: () => void, beginOperation: (next: Pending) => void) => Promise<void>, operation?: Pending, activityLabel: Activity | null = null) {
    if (!mounted.current || !active.current || authenticationBlocked.current || bootstrap.current || locked.current || (operation && pending.current)) return;
    // A late saved snapshot may never overwrite a newer mutation/recovery result.
    cancelReads(true);
    locked.current = true; setBusy(true); setActivity(activityLabel ?? (operation?.kind === 'generation' ? 'story' : null)); setNotice('');
    const stamp = epoch.current, abort = new AbortController(); controller.current = abort;
    let startedOperation = operation;
    if (startedOperation) pending.current = startedOperation;
    const check = () => { if (!mounted.current || !active.current || epoch.current !== stamp || abort.signal.aborted) throw new RealAiError('cancelled'); };
    const beginOperation = (next: Pending) => {
      check();
      if (startedOperation || pending.current) throw new RealAiError('cancelled');
      // Register only when a write may now be dispatched. Owned replay reads
      // must never manufacture a paid operation for background reconciliation.
      startedOperation = next; pending.current = next;
    };
    try { await action(abort.signal, check, beginOperation); check(); if (startedOperation) { pending.current = null; setUnresolved(null); } }
    catch (error) {
      if (mounted.current && active.current && epoch.current === stamp) {
        const memoryConflict = error instanceof RealAiError && error.code === 'REAL_AI_CONFLICT' && activityLabel === 'saving';
        if (memoryConflict && savedWordsOpen) setNotice(storyCopy.savedWordsConflict);
        else setNotice(memoryConflict && currentSection.current === 'memories' ? t.reviewConflict : failureMessage(error));
        if (allowanceError(error)) setUsageBlocked(true);
        if (error instanceof RealAiError && error.recovery === 'contact-operator' && error.code !== 'LIVE_AI_DISABLED' && !allowanceError(error)) setServiceBlocked(true);
        if (error instanceof RealAiError && error.code === 'LIVE_AI_DISABLED') {
          const kind = pending.current?.kind ?? startedOperation?.kind;
          const capability = kind === 'generation' ? 'writing' : kind;
          if (capability) setCapabilities(previous => previous ? { ...previous, [capability]: false } : previous);
        }
        if (error instanceof StoryProjectsError && error.mayHaveWritten) {
          if (startedOperation) { const current = pending.current ?? startedOperation;
            const saved = { ...current, operationId: error instanceof RealAiError ? error.operationId ?? current.operationId : current.operationId };
            setUnresolved(saved); pending.current = saved; }
          else setAmbiguousEdit(true);
        } else if (startedOperation) {
          const failed = pending.current ?? startedOperation;
          if (failed.voiceTranscriptId && !(error instanceof StoryProjectsError && error.kind === 'authentication')) {
            setSafeReplyId(failed.voiceTranscriptId);
            if (!(error instanceof RealAiError && error.recovery)) setNotice(t.replyNotReady);
          }
          pending.current = null; setUnresolved(null);
        }
        if (error instanceof StoryProjectsError && error.kind === 'authentication') { authenticationBlocked.current = true; setAuthenticationFailed(true); cleanupAudio(); clearPrivate(); latest.current.onAuthenticationFailure?.(); }
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (epoch.current === stamp && mounted.current) { locked.current = false; setBusy(false); setActivity(null); setVoiceReplySending(false); setReplyPreview(null); }
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
    for (const resource of ['transcripts', 'messages', 'memories', 'drafts'] as const) updateRead(resource, { loaded: true, loading: false, error: '' });
  }
  function readFailure(error: unknown) {
    if (allowanceError(error)) setUsageBlocked(true);
        if (error instanceof RealAiError && error.recovery === 'contact-operator' && error.code !== 'LIVE_AI_DISABLED' && !allowanceError(error)) setServiceBlocked(true);
    if (error instanceof StoryProjectsError && error.kind === 'authentication') {
      authenticationBlocked.current = true; setAuthenticationFailed(true); epoch.current++; controller.current?.abort(); locked.current = false;
      cleanupAudio(); clearPrivate(); setBusy(false); setNotice(t.auth); latest.current.onAuthenticationFailure?.();
      return true;
    }
    return false;
  }
  function loadResource(resource: Resource, force = false, id = session.current): Promise<void> {
    const readingStoryDuringSpeech = activity === 'speech' && currentSection.current === 'book' &&
      (resource === 'drafts' || resource === 'memories');
    if (!id || !mounted.current || !active.current || authenticationBlocked.current ||
      (locked.current && !readingStoryDuringSpeech) || (resource === 'drafts' && editingDraft.current)) return Promise.resolve();
    const existing = readJobs.current.get(resource);
    if (existing) return existing.promise;
    if (reads.current[resource].loaded && !force) return Promise.resolve();
    const selectedDraft = currentDraft.current;
    if (resource === 'history' && !selectedDraft) return Promise.resolve();
    const stamp = epoch.current, ticket = ++readTickets.current[resource], abort = new AbortController();
    const current = () => mounted.current && active.current && epoch.current === stamp && !abort.signal.aborted &&
      readTickets.current[resource] === ticket && session.current === id;
    const job = { controller: abort, promise: Promise.resolve() };
    updateRead(resource, { loading: true, error: '' });
    job.promise = Promise.resolve().then(async () => {
      const owned = scope(abort.signal, id); let count = 0;
      if (resource === 'transcripts') { const items = await getRealTranscripts(owned); if (!current()) return; count = items.length; setTranscripts(items); }
      if (resource === 'messages') { const items = await getRealMessages(owned); if (!current()) return; count = items.length; setMessages(items); }
      if (resource === 'memories') { const items = await getRealMemories(owned); if (!current()) return; count = items.length; setMemories(items); }
      if (resource === 'drafts') {
        const items = await getRealDrafts(owned); if (!current()) return; count = items.length;
        const selection = chosenDraft.current;
        if (selection && !items.some(item => item.draft_id === selection)) {
          const saved = await getRealDraft(owned, selection); if (!current()) return; items.push(saved);
        }
        setDrafts(items);
      }
      if (resource === 'history') {
        const key = `${selectedDraft!.draft_id}:${selectedDraft!.revision}`;
        const items = await getRealDraftHistory(owned, selectedDraft!.draft_id); if (!current() || historyIdentity.current !== key) return;
        count = items.length; setHistory(items);
        if (!historyCache.current.has(key) && historyCache.current.size >= 10) historyCache.current.delete(historyCache.current.keys().next().value!);
        historyCache.current.set(key, { items, page: count === 100 ? 100 : null });
      }
      if (resource === 'exports') { const items = await getRealExports(owned); if (!current()) return; count = items.length; setExports(items); }
      if (!current()) return;
      setPages(previous => ({ ...previous, [resource]: count === 100 ? 100 : null }));
      updateRead(resource, { loaded: true, loading: false, error: '' });
    }).catch(error => {
      if (!current()) return;
      if (readFailure(error)) return;
      const message = reads.current[resource].loaded ? t.refreshFailed : failureMessage(error);
      updateRead(resource, { loading: false, error: message });
    }).finally(() => {
      if (readJobs.current.get(resource) === job) {
        readJobs.current.delete(resource);
        if (current() && reads.current[resource].loading) updateRead(resource, { loading: false });
      }
    });
    readJobs.current.set(resource, job); return job.promise;
  }
  function loadSection(section: typeof tab, force = false, id = session.current) {
    const resources: Resource[] = section === 'chat' ? ['messages', 'transcripts'] : section === 'memories' ? ['memories'] : ['drafts', 'memories'];
    for (const resource of resources) if (!reads.current[resource].error || force) void loadResource(resource, force, id);
  }
  const open = (force = false) => {
    if (!mounted.current || !active.current || authenticationBlocked.current || locked.current || bootstrap.current) return;
    const abort = new AbortController(), stamp = epoch.current;
    bootstrap.current = abort; setOpening(true); setNotice('');
    if (force) { cancelReads(true); historyCache.current.clear(); }
    const check = () => { if (!mounted.current || !active.current || stamp !== epoch.current || abort.signal.aborted) throw new RealAiError('cancelled'); };
    void (async () => {
      const options = { baseUrl: config.baseUrl, getAccessToken: () => getAccessToken(user.id), signal: abort.signal };
      // Preserve Charan's independent startup reads and the canonical Continue ownership contract.
      const [caps, sessions] = await Promise.all([getRealCapabilities(options),
        listStorySessions({ ...options, projectId: project.id, expectedLanguage: project.language })]);
      check(); setCapabilities(caps);
      const existing = sessions.find(item => item.status === 'active');
      if (!existing && continuing.current) { setAmbiguousEdit(true); setNotice(t.uncertain); return; }
      let id = existing?.id;
      if (!id) {
        continuing.current = true; setContinuationBusy(true);
        try { id = (await continueStoryProject({ ...options, projectId: project.id, expectedLanguage: project.language })).session.id; }
        catch (error) { if (!(error instanceof StoryProjectsError && error.mayHaveWritten)) continuing.current = false; throw error; }
      }
      check(); continuing.current = false;
      // An explicit reopen/refresh may recover an operator-paused service only
      // after fresh capabilities and the owned session have both been verified.
      // This does not renew any allowance or send a paid request automatically.
      if (caps.enabled) setServiceBlocked(false);
      if (session.current && session.current !== id) {
        speechBytes.clear(); speech.current.clear(); setOutbox(null); clearLatestReply(); replyLayouts.current.clear();
        cancelReads(); reads.current = emptyReads(); setReadStates(reads.current); historyCache.current.clear();
        setTranscripts([]); setMessages([]); setMemories([]); setDrafts([]); setHistory(null); setExports(null); setPages(emptyPages()); setSavedWordsOpen(false);
      }
      session.current = id; setSessionId(id); setSuspended(false);
      loadSection(currentSection.current, force, id);
      if (force) for (const resource of Object.keys(reads.current) as Resource[]) {
        if (reads.current[resource].loaded) void loadResource(resource, true, id);
      }
    })().catch(error => {
      if (!mounted.current || !active.current || stamp !== epoch.current || abort.signal.aborted) return;
      if (!readFailure(error)) { setNotice(failureMessage(error)); if (error instanceof StoryProjectsError && error.mayHaveWritten) setAmbiguousEdit(true); }
    }).finally(() => {
      if (bootstrap.current === abort) { bootstrap.current = null; if (mounted.current && stamp === epoch.current) { setOpening(false); setContinuationBusy(false); } }
    });
  };
  useEffect(() => {
    if (!suspended && !opening && (!busy || (tab === 'book' && activity === 'speech'))) loadSection(tab);
  }, [tab, sessionId, suspended, busy, opening, activity]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftIdentity = draft ? `${draft.draft_id}:${draft.revision}` : '';
  useLayoutEffect(() => {
    if (historyIdentity.current === draftIdentity) return;
    const job = readJobs.current.get('history'); job?.controller.abort(); readJobs.current.delete('history'); readTickets.current.history++;
    historyIdentity.current = draftIdentity;
    const cached = historyCache.current.get(draftIdentity);
    setHistory(cached?.items ?? null); setPages(previous => ({ ...previous, history: cached?.page ?? null }));
    updateRead('history', { loaded: !!cached, loading: false, error: '' });
  }, [draftIdentity]);
  useEffect(() => {
    const ownedSpeechMetadata = speech.current, ownedHistoryCache = historyCache.current, ownedCorrectionBases = correctionBases.current, ownedReplyLayouts = replyLayouts.current;
    mounted.current = true; active.current = AppState.currentState === 'active';
    if (active.current) open();
    const listener = AppState.addEventListener('change', state => {
      active.current = state === 'active';
      if (!active.current) {
        epoch.current++; controller.current?.abort(); locked.current = false; cleanupAudio(); clearPrivate();
        setBusy(false); setSuspended(true); setNotice('');
        // Retain only an operation ID for same-owner reconciliation, never audio or story wording.
        if (pending.current?.inputType === 'typed' && !pending.current.textDigest) {
          // Hashing had not completed: no typed POST can have been dispatched.
          pending.current = null; setUnresolved(null);
        } else if (pending.current) setUnresolved(pending.current);
      }
    });
    // Read the latest generation counter intentionally: this is a cancellation fence, not a mounted native element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; active.current = false; epoch.current++; controller.current?.abort();
      cleanupAudio(); cancelReads(); bootstrap.current?.abort(); bootstrap.current = null; pending.current = null;
      currentDraft.current = null; editingDraft.current = null; ownedCorrectionBases.clear(); ownedHistoryCache.clear(); ownedSpeechMetadata.clear(); latestReply.current = null; ownedReplyLayouts.clear(); listener.remove(); };
    // This component is keyed by verified owner/project/language. Configuration is fixed at entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkSaved = () => {
    if (!sessionId) { open(); return; }
    void run(async (signal, check) => {
      let completedTyped: RealTurn | null = null, typedFailed = false, failedVoiceId: string | null = null;
      if (pending.current) {
        const action = pending.current, expectedTyped = action.inputType === 'typed';
        const state = action.operationId
          ? expectedTyped ? await getRealOperation(scope(signal), action.operationId, true) : await getRealOperation(scope(signal), action.operationId)
          : expectedTyped ? await findRealOperation(scope(signal), action.kind, action.key, true) : await findRealOperation(scope(signal), action.kind, action.key); check();
        if (pending.current?.key !== action.key || state.kind !== action.kind) throw new RealAiError('invalid-response');
        if (pending.current) pending.current.operationId = state.operation_id;
        if (state.status === 'in_progress' || state.status === 'uncertain') { setNotice(t.operationPending); return; }
        typedFailed = expectedTyped && state.status === 'failed';
        if (state.status === 'failed' && action.voiceTranscriptId) failedVoiceId = action.voiceTranscriptId;
        if (expectedTyped && state.status === 'completed') {
          if (!state.typedTurn || !action.textDigest) throw new RealAiError('invalid-response');
          const turn = decodeRealTextTurn(state.typedTurn, scope(signal), undefined, state.operation_id);
          const originalDigest = await hashRealText(turn.user_message.text); check();
          if (pending.current?.key !== action.key || pending.current.textDigest !== action.textDigest ||
            originalDigest !== action.textDigest) throw new RealAiError('invalid-response');
          completedTyped = turn;
        }
        if (state.status === 'completed' && state.kind === 'speech') {
          if (!state.result || state.result.assistant_message_id !== pending.current?.assistantId) throw new RealAiError('invalid-response');
          speech.current.set(state.result.assistant_message_id, state.result);
          if (Date.parse(state.result.expires_at) <= Date.now()) setRenewSpeech(previous => new Set(previous).add(state.result!.assistant_message_id));
        }
        if (state.status === 'completed' && audio.current && recorder.current) {
          await recorder.current.discard(audio.current); check(); audio.current = null; setLocalRecording(null);
        }
      }
      await refresh(signal, check, sessionId); check(); pending.current = null; setUnresolved(null);
      if (completedTyped) {
        // The newest verified turn may lie beyond the first 100 saved messages.
        const turn = completedTyped;
        setMessages(previous => appendUnique(previous, [turn.user_message, turn.message], item => item.id).sort((a, b) => a.sequence - b.sequence));
        // Review status is mutable; only the freshly fetched memory page is authoritative.
        setTextDraft(''); presentReply(turn.message);
      }
      // Only a verified failed operation permits another deliberate paid attempt.
      if (failedVoiceId) setSafeReplyId(failedVoiceId);
      setAmbiguousEdit(false); editingDraft.current = null; setEditor(null); setNotice(typedFailed ? t.textNotSent : t.checked);
    }, undefined, 'checking');
  };
  const discardAudio = () => {
    if (!audio.current || !recorder.current || busy || unresolved) return;
    void run(async (_signal, check) => {
      await recorder.current!.discard(audio.current!); check(); audio.current = null; setLocalRecording(null);
    });
  };
  const replyAllowed = () => !!voiceContext.current.capabilities?.conversation && !voiceContext.current.usageBlocked && !serviceBlocked && !mediaPrivacy.isBlocked();
  function receiveReplyProgress(key: string, check: () => void) {
    return (event: RealConversationProgress) => {
      check();
      if (pending.current?.key !== key || pending.current.kind !== 'conversation') throw new RealAiError('cancelled');
      if (event.type === 'operation') {
        if (pending.current.operationId && pending.current.operationId !== event.operation_id) throw new RealAiError('invalid-response', undefined, true);
        pending.current = { ...pending.current, operationId: event.operation_id };
      } else if (event.type === 'reply') {
        setReplyPreview({ text: event.text, saving: false });
      } else if (event.type === 'saving') {
        setReplyPreview(previous => previous ? { ...previous, saving: true } : null);
      }
    };
  }
  async function voiceReply(signal: AbortSignal, check: () => void, transcript: RealTranscript, key: string) {
    check();
    pending.current = { key, kind: 'conversation', voiceTranscriptId: transcript.transcript_id };
    setSafeReplyId(null); clearLatestReply(); setVoiceReplySending(true);
    const result = await sendRealMessage(scope(signal), { source_transcript_id: transcript.transcript_id }, key, receiveReplyProgress(key, check)); check();
    setReplyPreview(null);
    setMessages(previous => appendUnique(previous, [result.user_message, result.message], item => item.id).sort((a, b) => a.sequence - b.sequence));
    setMemories(previous => appendUnique(previous, result.memories, item => item.id)); presentReply(result.message); setNotice(t.recordingSaved);
    if (modeRef.current === 'voice' && voiceConsent.current === voiceScope()) nextSpokenReply.current = result.message;
  }
  async function transcribeAndReply(signal: AbortSignal, check: () => void, captured: AudioRecording, key: string) {
    check();
    if (voiceConsent.current !== voiceScope() || !voiceContext.current.capabilities?.transcription || voiceContext.current.usageBlocked || mediaPrivacy.isBlocked()) {
      setNotice(t.voicePaused); return;
    }
    const result = await transcribeRealRecording(scope(signal), captured, true, key); check();
    setTranscripts(previous => [result, ...previous.filter(item => item.transcript_id !== result.transcript_id)]);
    // The immutable transcript is verified. Never upload this clip again, even
    // if deleting its local file fails. The recorder retains cleanup ownership.
    pending.current = null; audio.current = null; setLocalRecording(null); setSafeReplyId(result.transcript_id);
    try { await recorder.current?.discard(captured); check(); }
    catch { check(); cleanupAudio(); setNotice(t.recordingSavedReplyLater); return; }
    if (!replyAllowed()) { setNotice(t.recordingSavedReplyLater); return; }
    await voiceReply(signal, check, result, createRecordingId());
  }
  const discardCapture = () => {
    if (!capturing.current || !recorder.current || locked.current) return;
    const capturedBy = recorder.current;
    recorder.current = null; capturing.current = false; setRecording(false); setDuration(0);
    // Local retirement uses the existing privacy owner and creates no write.
    void run(async (_signal, check) => { await mediaPrivacy.retire(capturedBy); check(); });
  };
  const stopCapture = (userGesture = false) => {
    if (!capturing.current || !recorder.current || locked.current) return;
    // A second gesture can restore browser playback permission after the mic dialog.
    if (userGesture) playback.current?.prepare?.();
    capturing.current = false; setRecording(false);
    void run(async (signal, check, beginOperation) => {
      const recorded = await recorder.current!.stop(); check(); audio.current = recorded;
      setLocalRecording(recorded); setDuration(recorded.durationMs);
      // A time limit retains the clip. Only the arrow authorizes a write.
      if (userGesture) {
        const key = createRecordingId();
        beginOperation({ key, kind: 'transcription', voice: true });
        await transcribeAndReply(signal, check, recorded, key);
      }
    }, undefined, userGesture ? 'recording' : null);
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
  const beginCapture = () => {
    if (modeRef.current !== 'voice' || currentSection.current !== 'chat' || suspended || !mounted.current || authenticationBlocked.current || bootstrap.current || voiceConsent.current !== voiceScope() || !active.current || capturing.current || locked.current || !sessionId || !capabilities?.transcription || audio.current || unresolved || ambiguousEdit || usageBlocked || serviceBlocked || mediaPrivacy.isBlocked()) return;
    if (capabilities.speech) {
      playback.current ??= createRealPlayback();
      playback.current.prepare?.();
    }
    void run(async (_signal, check) => {
      if (playback.current) await playback.current.stop(); check(); setPlaying(false);
      recorder.current ??= createNativeRecorder();
      const allowed = await recorder.current.requestPermission(); check();
      if (!allowed) { setNotice(t.permission); return; }
      await recorder.current.start(); check(); capturing.current = true; setRecording(true); setDuration(0);
    });
  };
  const startCapture = () => {
    if ( currentSection.current !== 'chat' || suspended || !mounted.current || authenticationBlocked.current || bootstrap.current || !active.current || capturing.current || locked.current || !sessionId || !capabilities?.transcription || audio.current || unresolved || ambiguousEdit || usageBlocked || serviceBlocked || mediaPrivacy.isBlocked()) return;
    rememberMode('voice');
    if (voiceConsent.current !== voiceScope()) {
      consentIntent.current = { epoch: epoch.current, scope: voiceScope() }; setConsentOpen(true); return;
    }
    beginCapture();
  };
  const cancelConsent = () => { consentIntent.current = null; setConsentOpen(false); };
  const acceptConsent = () => {
    const intent = consentIntent.current;
    if (!intent || !mounted.current || !active.current || intent.epoch !== epoch.current || intent.scope !== voiceScope()) return;
    voiceConsent.current = intent.scope; cancelConsent(); beginCapture();
  };
  const retryRecording = () => {
    if (!audio.current || locked.current || unresolved || ambiguousEdit || usageBlocked || serviceBlocked || voiceConsent.current !== voiceScope()) return;
    playback.current?.prepare?.();
    const captured = audio.current, key = createRecordingId();
    void run((signal, check) => transcribeAndReply(signal, check, captured, key), { key, kind: 'transcription', voice: true }, 'recording');
  };
  // Owned reads restore explicit continuation after privacy clearing. A partial
  // message page cannot prove that a transcript has no saved conversation turn.
  const canReply = (transcript: RealTranscript) => transcript.project_id === project.id &&
    transcript.session_id === sessionId && transcript.language === project.language && transcript.status === 'completed' &&
    !unresolved && !ambiguousEdit && !suspended && !authenticationFailed &&
    !opening && !busy && !recording && !localRecording && !!capabilities?.conversation && !usageBlocked && !serviceBlocked && !mediaBlocked &&
    readStates.messages.loaded && !readStates.messages.loading && !readStates.messages.error &&
    (transcript.transcript_id === safeReplyId || (readStates.transcripts.loaded &&
      !readStates.transcripts.loading && !readStates.transcripts.error && pages.messages === null)) &&
    !messages.some(message => message.source_transcript_id === transcript.transcript_id);
  const ask = (transcript: RealTranscript) => {
    if (pending.current || !replyAllowed() || !canReply(transcript)) return;
    const key = createRecordingId();
    void run((signal, check) => voiceReply(signal, check, transcript, key), { key, kind: 'conversation', voiceTranscriptId: transcript.transcript_id });
  };
  const sendText = () => {
    if ( currentSection.current !== 'chat' || suspended || !mounted.current || authenticationBlocked.current || bootstrap.current || locked.current || pending.current || !active.current || !capabilities?.conversation || unresolved || ambiguousEdit || recording || localRecording || usageBlocked || serviceBlocked || !textDraft.trim() || [...textDraft].length > 4000) return;
    rememberMode('write');
    const original = textDraft, key = createRecordingId();
    void run(async (signal, check) => {
      setTextSending(true); setOutbox({ key, text: original }); setTextDraft(''); clearLatestReply();
      try {
        const textDigest = await hashRealText(original); check();
        if (pending.current?.key !== key) throw new RealAiError('cancelled');
        pending.current = { ...pending.current, textDigest };
        const result = await sendRealTextMessage(scope(signal), original, key, receiveReplyProgress(key, check)); check();
        setReplyPreview(null);
        setMessages(previous => appendUnique(previous, [result.user_message, result.message], item => item.id).sort((a, b) => a.sequence - b.sequence));
        setMemories(previous => appendUnique(previous, result.memories, item => item.id));
        setTextDraft(''); presentReply(result.message); setNotice(t.messageSent);
      } catch (error) {
        if (active.current && mounted.current && !signal.aborted) setTextDraft(original);
        throw error;
      } finally { if (active.current && mounted.current && !signal.aborted) { setTextSending(false); setOutbox(null); } }
    }, { key, kind: 'conversation', inputType: 'typed' });
  };
  const speak = (message: RealMessage, automatic = false) => {
    if (modeRef.current !== 'voice' || currentSection.current !== 'chat' || !active.current || locked.current || bootstrap.current ||
      unresolved || recording || localRecording || ambiguousEdit || mediaPrivacy.isBlocked() ||
      message.role !== 'assistant' || message.project_id !== project.id || message.session_id !== sessionId ||
      message.language !== project.language || !messages.some(saved => saved.id === message.id)) return;
    if (!automatic) {
      playback.current ??= createRealPlayback();
      playback.current.prepare?.();
    }
    const renewing = renewSpeech.has(message.id);
    const cached = renewing ? undefined : speech.current.get(message.id), key = createRecordingId();
    void run(async (signal, check, beginOperation) => {
      if (playback.current) await playback.current.stop(); check(); setPlaying(false);
      if (currentSection.current !== 'chat') return;
      const current = scope(signal);
      let metadata = cached, bytes: Uint8Array | undefined, fromCache = false;
      // One deliberate Listen may reuse owned audio or prepare one fresh clip.
      // Only verified free-read expiry authorizes moving to preparation below.
      try {
        if (metadata && Date.parse(metadata.expires_at) <= Date.now()) {
          speechBytes.get(metadata); speech.current.delete(message.id); metadata = undefined;
        }
        if (!metadata && !renewing) {
          try { metadata = await getPreparedRealSpeech(current, message.id); check(); }
          catch (error) {
            check();
            if (!(error instanceof RealAiError && error.status === 404) && !knownFreeSpeechExpiry(error)) throw error;
          }
        }
        if (metadata) {
          try {
            const saved = speechBytes.get(metadata); fromCache = saved !== null;
            bytes = saved ?? await getRealSpeechAudio(current, metadata); check();
          } catch (error) {
            check();
            if (!knownFreeSpeechExpiry(error)) throw error;
            speech.current.delete(message.id); metadata = undefined;
          }
        }
        if (!metadata) {
          if (currentSection.current !== 'chat') return;
          if (!capabilities?.speech || usageBlocked || serviceBlocked) {
            setRenewSpeech(previous => new Set(previous).add(message.id));
            setNotice(usageBlocked ? t.usageLimit : t.serviceUnavailable); return;
          }
          check(); beginOperation({ key, kind: 'speech', assistantId: message.id });
          try {
            metadata = await createRealSpeech(current, message.id, key); check();
            speech.current.set(message.id, metadata);
            bytes = await getRealSpeechAudio(current, metadata); check();
          } catch (error) {
            check();
            // A paid attempt has already begun. Never start another synthesis
            // or key, even when its result or newly prepared file is unavailable.
            if (error instanceof RealAiError && error.status === 410) {
              throw new RealAiError(error.kind, error.status, true, error.code, error.retry, error.operationId, 'check-saved');
            }
            throw error;
          }
        }
        check();
        if (!bytes) throw new RealAiError('invalid-response');
        speech.current.set(message.id, metadata);
        setRenewSpeech(previous => { const next = new Set(previous); next.delete(message.id); return next; });
        if (!fromCache) speechBytes.put(metadata, bytes);
        if (currentSection.current !== 'chat') return;
        playback.current ??= createRealPlayback();
        try {
          await playback.current.play(bytes, () => { if (mounted.current && active.current) setPlaying(false); });
          check();
          if (currentSection.current === 'chat') setPlaying(true);
        } catch (error) {
          check();
          if (currentSection.current !== 'chat') return;
          if (!automatic || !(error instanceof RealPlaybackError)) throw error;
          setNotice(t.spokenReplyReady);
        }
      } finally { bytes?.fill(0); }
    }, undefined, 'speech');
  };
  useLayoutEffect(() => { speakCurrent.current = speak; });
  useEffect(() => {
    if (busy || opening || recording || localRecording || finishRequested) return;
    const reply = nextSpokenReply.current;
    if (!reply) return;
    nextSpokenReply.current = null;
    if (tab === 'chat' && mode === 'voice' && !suspended && !unresolved &&
        voiceConsent.current && capabilities?.speech && !usageBlocked && !serviceBlocked) speakCurrent.current(reply, true);
  }, [busy, opening, recording, localRecording, finishRequested, tab, mode, suspended, unresolved, capabilities, usageBlocked, serviceBlocked]);
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
      const before = correction ? correctionBases.current.get(memory.id) ?? memory : memory;
      const result = await reviewRealMemory(scope(signal), before, status, correction || undefined); check();
      setMemories(previous => previous.map(item => item.id === result.id ? result : item));
      correctionBases.current.delete(memory.id);
      setCorrections(previous => { const next = { ...previous }; delete next[memory.id]; return next; });
      setNotice(status === 'rejected' ? t.memoryLeftOut : correction ? t.correctionSaved : t.memoryConfirmed);
    }, undefined, 'saving');
  };
  const generate = () => {
    if (!capabilities?.writing || !reads.current.memories.loaded || !generationConsent || hasOpenQuestions || unresolved || ambiguousEdit || usageBlocked || serviceBlocked || !hasConfirmedMemories) return;
    const key = createRecordingId();
    void run(async (signal, check) => { const result = await generateRealDraft(scope(signal), key); check();
      setDrafts(previous => [result, ...previous]); setSelected(result.draft_id); setHistory(null); setGenerationConsent(false); setNotice(t.bookCreated);
    }, { key, kind: 'generation' });
  };
  const saveEdit = () => {
    if (!draft || editor === null || unresolved || ambiguousEdit) return;
    const before = editingDraft.current ?? draft, content = editor;
    void run(async (signal, check) => { const result = await editRealDraft(scope(signal), before, content); check();
      setDrafts(previous => previous.map(item => item.draft_id === result.draft_id ? result : item)); editingDraft.current = null; setEditor(null); setHistory(null); setNotice(t.saved);
    }, undefined, 'saving');
  };
  const showHistory = () => { void loadResource('history', !!reads.current.history.error); };
  const sharePdf = () => {
    if (!draft || editor !== null || !privacy.ready || privacy.failed || unresolved || ambiguousEdit || busy) return;
    const captured = draft;
    void run(async (signal, check) => {
      releasePdf(); const store = latest.current.privacy.createStore(user.id); pdfStore.current = store;
      const refreshExports = reads.current.exports.loaded;
      try {
        const bytes = await exportRealDraft(scope(signal), captured);
        let handle;
        try {
          check();
          updateRead('exports', { loaded: false, loading: false, error: '' });
          setExports(null); setPages(previous => ({ ...previous, exports: null }));
          handle = await store.save(bytes); check();
        } finally { bytes.fill(0); }
        latest.current.privacy.rememberReturn(user.id, project.id, captured.draft_id);
        await store.share(handle); check();
        await store.discard(handle); check();
        // Deliver the requested PDF first. A free metadata refresh must not delay download/share.
        if (refreshExports) try {
          const items = await getRealExports(scope(signal)); check();
          setExports(items); setPages(previous => ({ ...previous, exports: items.length === 100 ? 100 : null }));
          updateRead('exports', { loaded: true, loading: false, error: '' });
        } catch (error) {
          check();
          if (readFailure(error)) throw error;
          updateRead('exports', { loading: false, error: failureMessage(error) });
        }
      } finally { latest.current.privacy.release(store); if (pdfStore.current === store) pdfStore.current = null; }
    }, undefined, 'pdf');
  };
  const showExports = () => { void loadResource('exports', !!reads.current.exports.error); };
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
    }, undefined, 'pdf');
  };
  const loadMore = (resource: Resource) => {
    const offset = pages[resource]; if (offset === null || offset >= 1000 || busy) return;
    void run(async (signal, check) => {
      const current = scope(signal); let count = 0;
      if (resource === 'transcripts') { const items = await getRealTranscripts(current, offset); check(); count = items.length; setTranscripts(previous => appendUnique(previous, items, item => item.transcript_id)); }
      if (resource === 'messages') { const items = await getRealMessages(current, offset); check(); count = items.length; setMessages(previous => appendUnique(previous, items, item => item.id).sort((a, b) => a.sequence - b.sequence)); }
      if (resource === 'memories') { const items = await getRealMemories(current, offset); check(); count = items.length; setMemories(previous => appendUnique(previous, items, item => item.id)); }
      if (resource === 'drafts') { const items = await getRealDrafts(current, offset); check(); count = items.length; setDrafts(previous => appendUnique(previous, items, item => item.draft_id).sort((a, b) => b.version - a.version)); }
      if (resource === 'history' && draft) { const items = await getRealDraftHistory(current, draft.draft_id, offset); check(); count = items.length;
        setHistory(previous => { const combined = appendUnique(previous ?? [], items, item => item.id);
          historyCache.current.set(`${draft.draft_id}:${draft.revision}`, { items: combined, page: count === 100 ? offset + 100 : null }); return combined; }); }
      if (resource === 'exports') { const items = await getRealExports(current, offset); check(); count = items.length; setExports(previous => appendUnique(previous ?? [], items, item => item.export_id)); }
      check(); setPages(previous => ({ ...previous, [resource]: count === 100 ? offset + 100 : null }));
    });
  };
  const dirty = !!textDraft || !!localRecording || recording || (editor !== null && editor !== draft?.content) || Object.values(corrections).some(Boolean);
  const leave = useGuardedLeave({ language, dirty, uncertain: !!unresolved || ambiguousEdit || busy || continuationBusy,
    onDiscard: () => { epoch.current++; controller.current?.abort(); cancelReads(true); bootstrap.current?.abort(); bootstrap.current = null; setOpening(false); setContinuationBusy(false); cleanupAudio();
      locked.current = false; setBusy(false); editingDraft.current = null; correctionBases.current.clear(); setEditor(null); setCorrections({}); setLocalRecording(null); setTextDraft(''); setTextSending(false); setOutbox(null); setActivity(null); setReplyPreview(null); clearLatestReply();
      setRecording(false); voiceConsent.current = null; consentIntent.current = null; setConsentOpen(false); setVoiceReplySending(false); setSafeReplyId(null); setPlaying(false); },
    onCheckSavedResult: checkSaved, checkDisabled: busy || !sessionId });
  const navigate = (next: typeof tab, finishing = false) => {
    if (tab === next) return;
    const move = () => {
      currentSection.current = next;
      nextSpokenReply.current = null;
      stopVoice();
      editingDraft.current = null;
      correctionBases.current.clear();
      setEditor(null);
      setCorrections({});
      setSavedWordsOpen(false);
      setFinishRequested(false);
      setTab(next);
    };
    // Section changes retain the same owned runtime and unsent composer text.
    // Keep pending work available for recovery when Finish opens the same story.
    if (finishing && !recording && (activity === 'speech' || unresolved || ambiguousEdit)) move();
    else if (next === 'chat' && tab === 'book' && localRecording && !recording && !busy && editor === null) move();
    else if (!finishing && !localRecording && !recording && (editor === null || editor === draft?.content) &&
      !Object.values(corrections).some(Boolean) && !unresolved && !ambiguousEdit && !busy && !continuationBusy) move();
    else leave.requestLeave(move);
  };
  const finish = () => {
    if (!active.current || suspended || authenticationBlocked.current) return;
    if (opening || (busy && activity !== 'speech') || !session.current) {
      setFinishRequested(true);
      if (!session.current && !opening && !busy) open();
      return;
    }
    navigate('book', true);
  };
  useEffect(() => {
    if (!finishRequested || busy || opening || suspended) return;
    let current = true;
    void Promise.resolve().then(() => {
      if (!current || !active.current || authenticationBlocked.current || locked.current || bootstrap.current) return;
      setFinishRequested(false);
      if (session.current) navigate('book', true);
    });
    return () => { current = false; };
  }, [finishRequested, busy, opening, suspended]); // eslint-disable-line react-hooks/exhaustive-deps
  const { requestLeave } = leave;
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { requestLeave(() => latest.current.onBack()); return true; });
    return () => listener.remove();
  }, [requestLeave]);
  const blocked = busy || opening || suspended || !!unresolved || ambiguousEdit || recording || !!localRecording || mediaBlocked;
  const openSavedWords = () => {
    if (blocked || !active.current || locked.current || !sessionId || currentSection.current === 'chat') return;
    setSavedWordsOpen(true);
    contentScroll.current?.scrollTo({ y: 0, animated: false });
    void loadResource('messages', !!reads.current.messages.error);
  };
  const saveMessageMemory = (message: RealMessage, excerpt: string) => {
    if (!savedWordsOpen || blocked || !reads.current.messages.loaded || reads.current.messages.loading ||
      reads.current.messages.error || message.role !== 'user' || message.session_id !== session.current ||
      message.project_id !== project.id || !messages.includes(message) ||
      memories.some(memory => isSavedMessageMemory(memory, message, excerpt))) return;
    void run(async (signal, check) => {
      const result = await saveRealMemoryFromMessage(scope(signal), message, excerpt); check();
      setMemories(previous => [...previous.filter(memory => memory.id !== result.id), result]);
      setNotice(t.memoryConfirmed);
    }, undefined, 'saving');
  };
  const closeSavedWords = () => {
    setSavedWordsOpen(false);
    contentScroll.current?.scrollTo({ y: 0, animated: false });
  };
  const rememberMode = (next: ConversationMode) => {
    modeRef.current = next;
    setPreferredMode(next);
    saveConversationMode(next);
  };
  const chooseMode = (next: ConversationMode) => {
    if (!active.current || locked.current || blocked || next === modeRef.current) return;
    nextSpokenReply.current = null;
    stopVoice();
    rememberMode(next);
  };
  const chatReady = readStates.messages.loaded && readStates.transcripts.loaded;
  const inputBlocked = busy || suspended || !!unresolved || ambiguousEdit || recording || !!localRecording || mediaBlocked || !chatReady;
  const actionDefaults = { language, disabled: blocked };
  const busyLabel = activity === 'recording' ? t.thinking : activity === 'speech' ? t.preparingVoice : activity === 'story' ? t.creatingStory
    : activity === 'pdf' ? t.preparingPdf : activity === 'checking' ? t.checkingSaved : activity === 'saving' ? t.savingChanges : t.busy;
  const note = (value: string) => <Text allowFontScaling accessibilityLanguage={locale} style={styles.note}>{value}</Text>;
  const checkbox = (label: string, checked: boolean, action: () => void, disabled: boolean) => <Pressable accessibilityRole="checkbox"
    accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={action} style={styles.checkbox}>
    <Text allowFontScaling accessibilityLanguage={locale} style={styles.body}>{checked ? '☑' : '☐'} {label}</Text></Pressable>;
  function readFeedback(resources: Resource[], loadingLabel: string, showLoading = true) {
    const visible = resources.map(resource => readStates[resource]);
    return <>
      {showLoading && visible.some(state => state.loading && !state.loaded) && note(loadingLabel)}
      {visible.some(state => state.loading && state.loaded) && note(t.refreshing)}
      {resources.map(resource => readStates[resource].error && <View key={resource} style={styles.card}>
        <Text allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLanguage={locale} style={styles.note}>{readStates[resource].error}</Text>
        <ActionButton language={language} label={t.retry} onPress={() => { void loadResource(resource, true); }}
          disabled={busy || opening || authenticationFailed} />
      </View>)}
    </>;
  }
  const composer = !suspended && tab === 'chat' && <View testID="conversation-composer" style={styles.composer}>
    {replyPreview && <View testID="live-reply-preview" style={styles.replyPreview}>
      <Text allowFontScaling accessibilityLanguage={locale} style={styles.speaker}>{t.replyPreviewTitle}</Text>
      <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.body}>{replyPreview.text}</Text>
      <Text allowFontScaling accessibilityLanguage={locale} accessibilityLiveRegion="polite" style={styles.note}>{replyPreview.saving ? t.replySaving : t.replyFinishing}</Text>
    </View>}
    {latestReplyId && replyAnchor?.id === latestReplyId && messages.some(message => message.id === latestReplyId) &&
      <ActionButton language={language} label={t.viewLatestReply} onPress={viewLatestReply} disabled={blocked} />}
    {(textSending || voiceReplySending) && !replyPreview && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.note}>{t.thinking}</Text>}
    {busy && !localRecording && !textSending && !voiceReplySending && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.note}>{busyLabel}</Text>}
    {recording || localRecording ? <>
      {busy && note(t.thinking)}
      <VoiceRecordingControls language={language} duration={duration} retained={!recording}
        disabled={busy || !!unresolved} sendDisabled={usageBlocked || serviceBlocked || mediaBlocked || !capabilities?.transcription}
        onDiscard={recording ? discardCapture : discardAudio} onSend={recording ? () => stopCapture(true) : retryRecording} />
    </> : <>
      {preferredMode === null && <>
        <Text allowFontScaling accessibilityLanguage={locale} style={styles.speaker}>{t.chooseMode}</Text>
        <View style={styles.modeChoices}>
          <View style={styles.modeAction}><ActionButton {...actionDefaults} label={t.writeMode} onPress={() => chooseMode('write')} /></View>
          <View style={styles.modeAction}><ActionButton {...actionDefaults} label={t.speakMode} onPress={() => chooseMode('voice')} /></View>
        </View>
      </>}
      <View testID="conversation-composer-row" style={[styles.composerRow, Math.min(width - layout.screenPadding * 2, layout.contentWidth) / Math.max(1, fontScale) < 320 && styles.stackedComposer]}>
        <TextInput testID="conversation-input" accessibilityLabel={t.input} accessibilityLanguage={locale} allowFontScaling placeholder={t.input} value={textDraft}
          multiline maxLength={8000} editable={!inputBlocked} style={styles.chatInput}
          onChangeText={value => {
            if (locked.current || !active.current) return;
            if (value && modeRef.current !== 'write') chooseMode('write');
            setTextDraft(value);
          }} />
        <View testID="conversation-composer-actions" style={styles.composerActions}>
          <VoiceAction language={language} label={playing ? t.stopVoice : t.start} icon={playing ? 'stop' : 'mic'}
            onPress={playing ? stopVoice : startCapture}
            disabled={!playing && (blocked || !chatReady || usageBlocked || serviceBlocked || !sessionId || !capabilities?.transcription)} />
          <SendAction language={language} label={t.send} onPress={sendText}
            disabled={blocked || !chatReady || usageBlocked || serviceBlocked || !sessionId || !capabilities?.conversation || !textDraft.trim() || [...textDraft].length > 4000} />
        </View>
      </View>
    </>}
    <View style={styles.modeChoices}>
      {preferredMode && !recording && !localRecording && <View style={styles.modeAction}>
        <ActionButton {...actionDefaults} label={mode === 'voice' ? conversationCopy.switchToWrite : conversationCopy.switchToVoice}
          onPress={() => chooseMode(mode === 'voice' ? 'write' : 'voice')} />
      </View>}
      <View style={styles.finishAction}>
        <ActionButton language={language} label={conversationCopy.finishAndOpenStory}
          onPress={finish} disabled={finishRequested} />
        {finishRequested && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
          allowFontScaling style={styles.note}>{conversationCopy.finishWaiting}</Text>}
      </View>
    </View>
  </View>;
  const pageResources: Resource[] = savedWordsOpen ? ['messages'] : tab === 'chat' ? ['transcripts', 'messages']
    : tab === 'memories' ? ['memories'] : ['drafts', 'history', 'exports'];
  const savedWordsPanel = savedWordsOpen && <>
    {readFeedback(['messages'], t.loadingChat)}
    <SavedWordsContent language={language} storyLanguage={project.language}
      messages={messages.filter(message => message.project_id === project.id && message.session_id === sessionId && message.language === project.language)}
      memories={memories} blocked={blocked || readStates.messages.loading || !!readStates.messages.error}
      loaded={readStates.messages.loaded && pages.messages === null} onSave={saveMessageMemory}
      onShareMemory={() => navigate('chat')} />
    {hasConfirmedMemories && note(hasOpenQuestions ? storyCopy.answerFirst
      : capabilities?.writing && !usageBlocked && !serviceBlocked ? storyCopy.savedWordsNext : storyCopy.aiUnavailable)}
    {hasConfirmedMemories && tab === 'memories' && <ActionButton {...actionDefaults}
      label={storyCopy.startStory} onPress={() => navigate('book')} primary />}
    <ActionButton {...actionDefaults}
      label={tab === 'memories' ? storyCopy.backToMemories : hasConfirmedMemories ? storyCopy.startStory : storyCopy.backToStory}
      onPress={closeSavedWords} primary={tab === 'book' && hasConfirmedMemories} />
  </>;
  const generationControls = <>
    {checkbox(t.generationConsent, generationConsent, () => setGenerationConsent(!generationConsent), blocked || editor !== null)}
    <ActionButton {...actionDefaults} label={t.generate} onPress={generate} disabled={blocked || usageBlocked || serviceBlocked || editor !== null || !generationConsent || hasOpenQuestions || !capabilities?.writing || !readStates.memories.loaded || !hasConfirmedMemories} primary />
  </>;
  const checkSavedAction = (unresolved || ambiguousEdit) && <ActionButton language={language}
    label={t.check} onPress={checkSaved} disabled={busy || recording || !sessionId} primary />;
  return <Screen scrollViewRef={contentScroll} onContentLayout={event => { scrollOffsets.current.body = event.nativeEvent.layout.y; }} working keyboardAware bottomKeyboardAware back={{ language, label: t.back, onPress: () => leave.requestLeave(() => latest.current.onBack()) }}
    bottomControls={composer}><View style={styles.workspace} testID="real-workspace-layout" onLayout={event => { scrollOffsets.current.workspace = event.nativeEvent.layout.y; }}>
    <StoryDisclosure language={language} label={t.moreActions} compact
      heading={<StoryHeading title={project.title} language={language} storyLanguage={project.language} />}>
      {onStoryDetails && <AccountAction language={language} quiet label={t.storyDetails}
        onPress={() => leave.requestLeave(() => latest.current.onStoryDetails?.())} />}
      <StoryDisclosure language={language} label={t.privacy}>
        {note(t.textConsent)}{note(t.introduction)}{note(t.voice)}
      </StoryDisclosure>
      {!suspended && <AccountAction language={language} quiet label={t.reload}
        onPress={() => { if (unresolved || ambiguousEdit) checkSaved(); else open(true); }} disabled={busy || opening || recording || !!localRecording || editor !== null} />}
      <AccountAction language={language} quiet label={t.signOut} onPress={() => leave.requestLeave(() => latest.current.onSignOut())} />
    </StoryDisclosure>
    {notice !== '' && <Text allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    {usageBlocked && note(t.usageLimit)}
    {serviceBlocked && note(t.serviceUnavailable)}
    {mediaBlocked && <View style={styles.card}>{note(t.cleanupBlocked)}<ActionButton language={language} label={t.retryCleanup}
      onPress={() => { void mediaPrivacy.retry(); }} /></View>}
    {suspended ? <>{note(t.background)}<ActionButton language={language} label={t.resume} onPress={open} disabled={busy} primary /></> : <>
      {opening && !capabilities && note(t.loading)}
      <View style={styles.tabs}>{(['chat', 'memories', 'book'] as const).map(item => <Pressable key={item} accessibilityRole="tab"
        accessibilityLabel={t[item]} accessibilityLanguage={locale} accessibilityState={{ selected: tab === item, disabled: busy }}
        disabled={busy} onPress={() => navigate(item)} style={[styles.tab, tab === item && styles.selectedTab]}>
        <View style={styles.tabIcon}><NavigationIcon name={item} /></View><Text allowFontScaling style={styles.tabText}>{t[item]}</Text></Pressable>)}</View>
      {capabilities && !capabilities.enabled && <AvailabilityNotice language={language} />}
      {tab !== 'chat' && checkSavedAction}
      {tab === 'chat' && <>
        {readFeedback(['messages', 'transcripts'], t.loadingChat)}
        {(transcripts.length > 0 || messages.some(message => message.role === 'user')) &&
          <StoryDisclosure language={language} label={t.yourWords}>
            <OriginalWordsEvidence messages={messages} transcripts={transcripts} language={language} storyLanguage={project.language} />
          </StoryDisclosure>}
        {mode === 'voice' && note(t.speakModeHint)}
        {!suspended && (recording || playing || activity === 'recording' || activity === 'speech' || voiceReplySending) && <RecordingWakeLock />}
        <View style={styles.thread} testID="real-ai-chat-thread" onLayout={event => { scrollOffsets.current.thread = event.nativeEvent.layout.y; }}>
          {chatReady && !messages.length && !transcripts.length && note(t.noMessages)}
          <ChatMessageHistory messages={messages} language={language} storyLanguage={project.language} blocked={blocked}
            renewSpeech={renewSpeech} showAudio={mode === 'voice'} speechBlocked={usageBlocked || serviceBlocked || !capabilities?.speech} onSpeak={onSpeak} onMessageLayout={recordMessageLayout} />
          {unplacedTranscripts.map(source => <View key={source.transcript_id} style={[styles.bubble, styles.userBubble]}>
            <Text allowFontScaling style={styles.speaker}>{t.you}</Text>{note(t.voiceMessage)}
            <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.body}>{source.text}</Text>
            {canReply(source) && <ActionButton {...actionDefaults} label={t.process} onPress={() => ask(source)}
              disabled={blocked || usageBlocked || serviceBlocked || !capabilities?.conversation} primary />}
          </View>)}
          {outbox && <View testID="pending-typed-message" style={[styles.bubble, styles.userBubble]}>
            <Text allowFontScaling accessibilityLanguage={locale} style={styles.speaker}>{t.you}</Text>
            <Text allowFontScaling selectable accessibilityLanguage={accessibilityLanguages[project.language]} style={styles.body}>{outbox.text}</Text>
            <Text allowFontScaling accessibilityLiveRegion="polite" accessibilityLanguage={locale} style={styles.note}>{t.sending}</Text>
          </View>}
        </View>
        {memories.some(item => item.status === 'pending') && <>
          {hasOpenQuestions && note(conversationCopy.reviewQuestions)}
          <ActionButton {...actionDefaults} label={t.reviewSuggested} onPress={() => navigate('memories')} />
        </>}
      </>}
      {tab !== 'chat' && savedWordsPanel}
      {tab === 'memories' && !savedWordsOpen && <>{readFeedback(['memories'], t.loadingMemories)}{readStates.memories.loaded && <MemoriesContent language={language} storyLanguage={project.language} memories={memories}
        corrections={corrections} blocked={blocked} busy={busy}
        onBeginCorrection={memory => {
          if (!active.current || locked.current || authenticationBlocked.current || unresolved || ambiguousEdit) return;
          const job = readJobs.current.get('memories'); job?.controller.abort(); readJobs.current.delete('memories'); readTickets.current.memories++;
          updateRead('memories', { loading: false });
          if (!correctionBases.current.has(memory.id)) correctionBases.current.set(memory.id, memory);
        }}
        onCorrection={(id, value) => { if (!busy && active.current) setCorrections(previous => ({ ...previous, [id]: value })); }}
        onReview={review} onShareMemory={() => navigate('chat')} onOpenStory={() => navigate('book')} onUseSavedWords={openSavedWords} />}</>}
      {tab === 'book' && !savedWordsOpen && <>{readFeedback(['drafts'], t.loadingBook)}{readFeedback(['memories'], t.loadingMemories, false)}
        {(['history', 'exports'] as const).map(resource => readStates[resource].error && <Text key={resource} allowFontScaling
          accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.note}>{readStates[resource].error}</Text>)}
        {readStates.drafts.loaded && <AutobiographyContent key={`${draft?.draft_id ?? 'empty'}:${draft?.revision ?? 0}`}
        language={language} storyLanguage={project.language} draft={draft} drafts={drafts} memories={memories} editor={editor}
        history={history} exports={exports} memoriesLoading={!readStates.memories.loaded && !readStates.memories.error}
        memoriesUnavailable={!readStates.memories.loaded && !!readStates.memories.error} historyLoading={readStates.history.loading} exportsLoading={readStates.exports.loading} blocked={blocked} busy={busy} ambiguousEdit={ambiguousEdit} usageBlocked={usageBlocked || serviceBlocked}
        writingAvailable={!!capabilities?.writing} privacyReady={privacy.ready} privacyFailed={privacy.failed} generationControls={generationControls}
        onEdit={() => { if (!blocked && active.current && !locked.current && !bootstrap.current && !authenticationBlocked.current) {
          const job = readJobs.current.get('drafts'); job?.controller.abort(); readJobs.current.delete('drafts'); readTickets.current.drafts++;
          updateRead('drafts', { loading: false }); editingDraft.current = draft; setEditor(draft!.content);
        } }}
        onChangeEditor={value => { if (!busy && active.current) setEditor(value); }} onSave={saveEdit}
        onCancel={() => leave.requestLeave(() => { editingDraft.current = null; setEditor(null); })}
        onSelectDraft={item => leave.requestLeave(() => { setSelected(item.draft_id); editingDraft.current = null; setEditor(null); })}
        onLoadHistory={showHistory} onLoadExports={showExports} onExport={sharePdf} onDownloadExport={shareSavedPdf}
        onReviewMemories={() => navigate('memories')} onShareMemory={() => navigate('chat')} onUseSavedWords={openSavedWords} />}</>}
      {(Object.keys(pages) as Resource[]).filter(resource => pages[resource] !== null && pageResources.includes(resource)).map(resource =>
        <View key={resource} style={styles.card}>{note(`${t.moreSaved}: ${t[resource]}`)}
          {(pages[resource] ?? 0) >= 1000 ? note(t.pageLimit) : <ActionButton {...actionDefaults} label={`${t.loadMore}: ${t[resource]}`} onPress={() => loadMore(resource)}
            disabled={blocked || editor !== null || (savedWordsOpen && (readStates.messages.loading || !!readStates.messages.error))} />}
        </View>)}
      {tab === 'chat' && checkSavedAction}
    </>}
    {busy && tab !== 'chat' && !localRecording && !textSending && !voiceReplySending && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.note}>{busyLabel}</Text>}
    {notice === t.auth && <AccountAction language={language} quiet label={t.signOut} onPress={() => leave.requestLeave(() => latest.current.onSignOut())} />}
    {consentOpen && <Modal visible transparent={false} animationType="none" onRequestClose={cancelConsent}>
      <Screen><View accessibilityViewIsModal style={styles.workspace}>
        <StoryHeading language={language} title={t.consentTitle} />
        <Text allowFontScaling accessibilityLanguage={locale} style={styles.body}>{t.consent}</Text>
        <Text allowFontScaling accessibilityLanguage={locale} style={styles.body}>{t.recordingLimit}</Text>
        <ActionButton language={language} label={t.consentContinue} onPress={acceptConsent} primary />
        <ActionButton language={language} label={t.consentCancel} onPress={cancelConsent} />
      </View></Screen>
    </Modal>}
    {leave.dialog}
  </View></Screen>;
}
const styles = StyleSheet.create({
  workspace: { width: '100%', gap: 16 }, note: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 19, lineHeight: 29, backgroundColor: colors.selected, padding: 16, borderRadius: 16 },
  tabIcon: { alignSelf: 'center', marginBottom: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tab: { minHeight: layout.minimumTouchTarget, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderBottomWidth: 3,
    borderColor: 'transparent', justifyContent: 'center', flexGrow: 1 },
  selectedTab: { borderColor: colors.forest, backgroundColor: colors.selected }, tabText: { color: colors.forest, textAlign: 'center', fontSize: 20, lineHeight: 30, fontWeight: '600', flexShrink: 1 },
  card: { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.border },
  availability: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.selected, borderRadius: 20, gap: 8 },
  availabilitySummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  availabilityText: { color: colors.muted, fontSize: 17, lineHeight: 26, flexGrow: 1, flexShrink: 1, flexBasis: 220 },
  availabilityDetails: { minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, maxWidth: '100%',
    paddingHorizontal: 4, paddingVertical: 8, borderWidth: 2, borderColor: 'transparent', justifyContent: 'center' },
  availabilityLabel: { color: colors.forest, fontSize: 17, lineHeight: 26, flexShrink: 1, textDecorationLine: 'underline' },
  availabilityExplanation: { color: colors.muted, fontSize: 17, lineHeight: 26, flexShrink: 1 },
  availabilityPressed: { backgroundColor: colors.paper },
  thread: { gap: 24 }, bubble: { maxWidth: '96%', gap: 8, padding: 16, borderRadius: 18 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.selected, borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  speaker: { fontSize: 18, lineHeight: 27, fontWeight: '600', color: colors.forest }, body: { color: colors.ink, fontSize: 21, lineHeight: 33 },
  composer: { gap: 12 },
  modeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeAction: { flexGrow: 1, flexBasis: 128, maxWidth: '100%' },
  finishAction: { flexGrow: 1, flexBasis: 190, maxWidth: '100%' },
  replyPreview: { gap: 8, padding: 14, marginBottom: 8, borderRadius: 16, backgroundColor: colors.selected },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 8,
    backgroundColor: colors.cream, borderRadius: 28, borderWidth: 1, borderColor: colors.border },
  stackedComposer: { flexDirection: 'column', alignItems: 'stretch' },
  composerActions: { flexDirection: 'row', alignSelf: 'flex-end', gap: 4, flexWrap: 'wrap', flexShrink: 0 },
  composerAction: { minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center',
    padding: 12, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  sendAction: { backgroundColor: colors.forest }, actionPressed: { opacity: 0.8 }, actionFocused: { borderColor: colors.ink }, actionDisabled: { opacity: 0.5 },
  chatInput: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: layout.minimumTouchTarget, maxHeight: 176, paddingHorizontal: 8, paddingVertical: 8,
    color: colors.ink, fontSize: 21, lineHeight: 33, textAlignVertical: 'top' },
  checkbox: { minHeight: layout.minimumTouchTarget, paddingVertical: 8 },
});
