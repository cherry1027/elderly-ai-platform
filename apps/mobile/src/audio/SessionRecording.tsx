import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { listSessionTranscripts, uploadSessionRecording, AudioTranscriptError,
  type AudioRecording } from '../api/audio-transcripts';
import { StoryProjectsError } from '../api/story-projects';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import type { Language } from '../i18n';
import { createNativeRecorder, createRecordingId, RecordingFailure, type RecordingDriver } from './native-recorder';
import { RecordingPanel, type AudioPanelState, type AudioUIError } from './RecordingPanel';

export interface SessionRecordingHandle { requestLeave: (proceed: () => void) => void }
interface Props {
  language: Language;
  ownerId: string;
  projectId: string;
  sessionId: string;
  sessionLanguage: 'en' | 'sv';
  baseUrl: string | null;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
}
const initial: AudioPanelState = { phase: 'idle', durationMs: 0, consent: false, transcripts: [],
  hasRecording: false, canRetry: false, historyLoading: false, historyFailed: false, error: undefined, uploadDiagnostic: undefined };
type Pending = { recording: AudioRecording; key: string };

function errorKind(error: unknown): AudioUIError {
  if (error instanceof RecordingFailure) {
    switch (error.stage) {
      case 'foreground': return 'recording-foreground';
      case 'audio-mode': return 'recording-audio-mode';
      case 'creation': case 'preparation': return 'recording-preparation';
      case 'file-validation': return 'recording-file';
      case 'startup': return 'recording-startup';
      case 'interrupted': return 'recording-interrupted';
      default: return 'recording';
    }
  }
  const code = error instanceof AudioTranscriptError ? error.code : undefined;
  if (code === 'TRANSCRIPTION_DISABLED') return 'disabled';
  if (code === 'TRANSCRIPTION_IN_PROGRESS') return 'in-progress';
  if (code === 'SESSION_COMPLETED') return 'completed-session';
  if (code === 'TRANSCRIPTION_CONFLICT') return 'conflict';
  if ((code === 'RECORDING_TOO_LARGE' || code === 'RECORDING_TOO_LONG')) return 'too-large';
  if (code === 'UNSUPPORTED_MEDIA_TYPE' || code === 'UNSUPPORTED_AUDIO_FORMAT' || code === 'INVALID_RECORDING' || code === 'AUDIO_PROCESSING_LIMIT') return 'format';
  if (code === 'AUDIO_BUSY') return 'busy';
  if (error instanceof StoryProjectsError) {
    if (error.status === 429) return 'busy';
    if (error.kind === 'forbidden' || error.kind === 'not-found') return 'access';
    if (error.kind === 'validation') return 'format';
    if (error.kind === 'conflict') return 'conflict';
    if (error.kind === 'cancelled') return 'network';
    return error.kind;
  }
  return 'recording';
}

/** Keyed scope prevents any old account/session frame from being rendered. */
export const SessionRecording = forwardRef<SessionRecordingHandle, Props>(function SessionRecording(props, ref) {
  return <RecordingScope key={`${props.ownerId}:${props.projectId}:${props.sessionId}:${props.sessionLanguage}`}
    {...props} ref={ref} />;
});

const RecordingScope = forwardRef<SessionRecordingHandle, Props>(function RecordingScope({
  language, ownerId, sessionId, sessionLanguage, baseUrl, getAccessToken,
}, ref) {
  const [state, setState] = useState<AudioPanelState>(initial);
  const stateRef = useRef(state);
  const alive = useRef(false);
  const mounted = useRef(false);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const epoch = useRef(0);
  const driver = useRef<RecordingDriver | null>(null);
  const pending = useRef<Pending | null>(null);
  const upload = useRef<AbortController | null>(null);
  const history = useRef<AbortController | null>(null);
  const historyVersion = useRef(0);
  const enabled = !!baseUrl && !readStoryPreviewEnabled();
  const update = (patch: Partial<AudioPanelState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    if (alive.current) setState(stateRef.current);
  };
  const current = (version: number) => alive.current && epoch.current === version;
  const clearLocal = async () => {
    const item = pending.current;
    pending.current = null;
    if (item && driver.current) await driver.current.discard(item.recording).catch(() => {});
  };
  const shutdown = () => {
    alive.current = false;
    epoch.current += 1;
    upload.current?.abort();
    upload.current = null;
    history.current?.abort();
    history.current = null;
    pending.current = null;
    const recorder = driver.current;
    driver.current = null;
    // dispose stops and releases the recorder before removing only its owned files.
    cleanup.current = recorder?.dispose().catch(() => {}) ?? cleanup.current;
  };

  const loadHistory = () => {
    if (!alive.current || !enabled || !baseUrl || history.current) return;
    const controller = new AbortController();
    history.current = controller;
    const version = ++historyVersion.current;
    update({ historyLoading: true, historyFailed: false });
    void listSessionTranscripts({ baseUrl, sessionId, expectedLanguage: sessionLanguage,
      getAccessToken: () => getAccessToken(ownerId), signal: controller.signal })
      .then(transcripts => {
        if (!alive.current || controller.signal.aborted || historyVersion.current !== version) return;
        // Never infer an uncertain upload's identity from the latest history row.
        update({ transcripts });
      }).catch(() => {
        if (alive.current && !controller.signal.aborted && historyVersion.current === version) update({ historyFailed: true });
      }).finally(() => {
        if (history.current === controller) {
          history.current = null;
          if (alive.current) update({ historyLoading: false });
        }
      });
  };

  useEffect(() => {
    mounted.current = true;
    alive.current = true;
    if (!enabled) update({ ...initial, phase: 'error', error: 'configuration' });
    else {
      try { driver.current = createNativeRecorder(); }
      catch { update({ phase: 'error', error: 'recording' }); }
      loadHistory();
    }
    const changes = AppState.addEventListener('change', value => {
      if (value !== 'active') {
        shutdown();
        setState({ ...initial, phase: 'stopping' });
      } else {
        if (alive.current) return;
        const version = epoch.current;
        void cleanup.current.then(() => {
          if (!mounted.current || alive.current || epoch.current !== version) return;
          alive.current = true;
          update({ ...initial, phase: enabled ? 'idle' : 'error', error: enabled ? undefined : 'configuration' });
          loadHistory();
        });
      }
    });
    return () => { mounted.current = false; changes.remove(); shutdown(); };
    // The outer key remounts for account/project/session/language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const stop = async () => {
    if (!alive.current || stateRef.current.phase !== 'recording' || !driver.current) return;
    const version = epoch.current;
    update({ phase: 'stopping' });
    const recorder = driver.current;
    try {
      const recording = await recorder.stop();
      if (!current(version)) return;
      const key = createRecordingId();
      pending.current = { recording, key };
      update({ phase: 'ready', durationMs: recording.durationMs, consent: false, hasRecording: true, error: undefined });
    } catch (error) {
      if (driver.current === recorder) driver.current = null;
      void recorder.dispose().catch(() => {});
      if (current(version)) update({ phase: 'error', error: errorKind(error), hasRecording: false, consent: false });
    }
  };
  useEffect(() => {
    if (state.phase !== 'recording') return;
    const timer = setInterval(() => {
      if (!alive.current || stateRef.current.phase !== 'recording') return;
      try {
        const status = driver.current?.getStatus();
        if (!status || status.interrupted) {
          update({ phase: 'error', error: 'recording-interrupted' });
          const recorder = driver.current;
          driver.current = null;
          void recorder?.dispose().catch(() => {});
          return;
        }
        update({ durationMs: status.durationMs });
        // Native recording also has a 60-second cap. Polling catches native auto-stop.
        if (status.durationMs >= 60_000 || !status.isRecording) void stop();
      } catch { void stop(); }
    }, 250);
    return () => clearInterval(timer);
    // stop uses refs; re-creating the timer for each duration update is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const start = async () => {
    if (!alive.current || !enabled || !baseUrl || pending.current ||
      !['idle', 'completed', 'error'].includes(stateRef.current.phase)) return;
    const version = epoch.current;
    // Ref state changes synchronously, before either a second tap or permission await.
    update({ phase: 'permission', error: undefined, durationMs: 0, consent: false, canRetry: false, uploadDiagnostic: undefined });
    let recorder: RecordingDriver | null = null;
    try {
      const token = await getAccessToken(ownerId).catch(() => null);
      if (!current(version)) return;
      if (!token) { update({ phase: 'error', error: 'authentication' }); return; }
      if (!driver.current) driver.current = createNativeRecorder();
      recorder = driver.current;
      const granted = await recorder.requestPermission();
      if (!current(version)) return;
      if (!granted) { update({ phase: 'error', error: 'permission' }); return; }
      const verified = await getAccessToken(ownerId).catch(() => null);
      if (!current(version)) return;
      if (!verified) { update({ phase: 'error', error: 'authentication' }); return; }
      update({ phase: 'preparing' });
      await recorder.start();
      if (!current(version)) { void recorder.dispose().catch(() => {}); return; }
      update({ phase: 'recording', durationMs: 0 });
    } catch (error) {
      if (recorder) {
        if (driver.current === recorder) driver.current = null;
        void recorder.dispose().catch(() => {});
      }
      if (current(version)) update({ phase: 'error', error: errorKind(error) });
    }
  };
  const send = async () => {
    const item = pending.current;
    if (!alive.current || !enabled || !baseUrl || !item || !stateRef.current.consent ||
      !['ready', 'uncertain', 'error'].includes(stateRef.current.phase) || upload.current ||
      (['error', 'uncertain'].includes(stateRef.current.phase) && !stateRef.current.canRetry)) return;
    const version = epoch.current;
    const controller = new AbortController();
    upload.current = controller;
    update({ phase: 'uploading', error: undefined, canRetry: false, uploadDiagnostic: undefined });
    try {
      const transcript = await uploadSessionRecording({ baseUrl, sessionId, expectedLanguage: sessionLanguage,
        recording: item.recording, idempotencyKey: item.key, consent: true,
        getAccessToken: () => getAccessToken(ownerId), signal: controller.signal,
        onDiagnostic: diagnostic => {
          if (current(version) && !controller.signal.aborted && pending.current === item) update({ uploadDiagnostic: diagnostic });
        } });
      if (!current(version) || controller.signal.aborted || pending.current !== item) return;
      // An in-flight history read must not overwrite a newly confirmed upload.
      historyVersion.current += 1;
      history.current?.abort();
      update({ phase: 'completed', transcripts: [...stateRef.current.transcripts.filter(row =>
        row.transcript_id !== transcript.transcript_id), transcript], hasRecording: false, consent: false });
      await clearLocal();
    } catch (error) {
      if (!current(version) || controller.signal.aborted) return;
      const kind = errorKind(error);
      const uncertain = !(error instanceof StoryProjectsError) || error.mayHaveWritten;
      const retryable = !['configuration', 'authentication', 'access', 'format', 'too-large', 'completed-session', 'conflict'].includes(kind);
      update({ phase: uncertain ? 'uncertain' : 'error', error: kind, canRetry: retryable, hasRecording: true });
    } finally {
      if (upload.current === controller) upload.current = null;
    }
  };
  const discard = () => {
    if (!alive.current || !pending.current || ['uploading', 'stopping'].includes(stateRef.current.phase)) return;
    const uncertain = stateRef.current.phase === 'uncertain';
    Alert.alert(language === 'sv' ? 'Ta bort inspelningen?' : 'Discard recording?',
      uncertain
        ? language === 'sv' ? 'Uppladdningen kan redan ha behandlats. Det här tar bara bort den lokala inspelningen och möjligheten att försöka igen.'
          : 'The upload may already have been processed. This removes only the local recording and the ability to retry it.'
        : language === 'sv' ? 'Din inspelning tas bort från den här enheten.' : 'Your recording will be removed from this device.',
      [{ text: language === 'sv' ? 'Behåll' : 'Keep', style: 'cancel' },
        { text: language === 'sv' ? 'Ta bort' : 'Discard', style: 'destructive', onPress: () => {
          if (!alive.current || upload.current) return;
          update({ phase: 'stopping' });
          void clearLocal().finally(() => {
            if (alive.current) update({ phase: 'idle', durationMs: 0, hasRecording: false, consent: false, error: undefined, uploadDiagnostic: undefined });
          });
        } }]);
  };
  useImperativeHandle(ref, () => ({
    requestLeave(proceed) {
      if (!alive.current) { proceed(); return; }
      const leave = () => { if (!alive.current) return; shutdown(); proceed(); };
      if (!pending.current && !['permission', 'preparing', 'recording', 'stopping'].includes(stateRef.current.phase)) { leave(); return; }
      Alert.alert(language === 'sv' ? 'Lämna inspelningen?' : 'Leave recording?',
        language === 'sv'
          ? 'Den lokala inspelningen tas bort. En påbörjad uppladdning kan redan ha behandlats; du kan se sparade simuleringar när du kommer tillbaka.'
          : 'The local recording will be removed. A started upload may already have been processed; saved simulations can be checked when you return.',
        [{ text: language === 'sv' ? 'Stanna' : 'Stay', style: 'cancel' },
          { text: language === 'sv' ? 'Lämna' : 'Leave', style: 'destructive', onPress: leave }]);
    },
  }));
  return <RecordingPanel language={language} state={state} onStart={() => { void start(); }}
    onStop={() => { void stop(); }} onConsentChange={consent => {
      if (alive.current && pending.current && ['ready', 'error', 'uncertain'].includes(stateRef.current.phase)) update({ consent });
    }} onUpload={() => { void send(); }} onDiscard={discard} onRetryHistory={loadHistory} />;
});
