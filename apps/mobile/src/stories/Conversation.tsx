import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { SessionRecording, type SessionRecordingHandle } from '../audio/SessionRecording';
import type { AuthUser } from '../auth/client';
import { readMobileApiConfig } from '../api/config';
import { continueStoryProject, listStorySessions, StoryProjectsError, type StoryProject } from '../api/story-projects';
import type { Language } from '../i18n';
import { conversationCopy } from '../conversation-copy';
import { MemoryReview } from '../memories/MemoryReview';
import { ConversationScreen, type ConversationState } from '../screens/ConversationScreen';

interface Props {
  language: Language;
  user: AuthUser;
  project: StoryProject;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onBack: () => void;
  onSignOut: () => void;
  reviewOnOpen?: boolean;
  backLabel?: string;
}

/** Mounted only by an intentional action on a freshly loaded, owned story. */
export function Conversation({ language, user, project, getAccessToken, onBack, onSignOut, reviewOnOpen = false, backLabel }: Props) {
  const [config] = useState(readMobileApiConfig);
  const recording = useRef<SessionRecordingHandle | null>(null);
  const [reviewIdentity, setReviewIdentity] = useState<string | null>(null);
  const selected = useMemo(() => ({ id: project.id, title: project.title, language: project.language }),
    [project.id, project.title, project.language]);
  const identity = `${user.id}:${selected.id}:${selected.language}`;
  const latest = useRef(identity);
  // Commit the identity before passive work or user actions can publish results.
  // The frame comparison below also hides old account data during render.
  useLayoutEffect(() => { latest.current = identity; }, [identity]);
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState<{ identity: string; revision: number; state: ConversationState }>({
    identity, revision: 0, state: { status: 'loading' },
  });
  const alive = useRef(false);
  const generation = useRef(0);
  const phase = useRef<'loading' | 'ready' | 'error' | 'left'>('loading');
  const uncertain = useRef(false);
  const blocked = useRef(false);
  const selection = useRef(identity);
  const request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (phase.current === 'left') return;
    if (selection.current !== identity) { uncertain.current = false; blocked.current = false; }
    selection.current = identity;
    alive.current = true;
    phase.current = 'loading';
    setFrame({ identity, revision, state: { status: 'loading' } });
    const attempt = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    const owner = user.id;
    const current = () => alive.current && latest.current === identity &&
      generation.current === attempt && !controller.signal.aborted;
    let postStarted = false;
    const fail = (error: unknown) => {
      if (!current()) return;
      const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, postStarted);
      if (failure.mayHaveWritten) uncertain.current = true;
      blocked.current = ['configuration', 'authentication', 'forbidden', 'not-found', 'validation'].includes(failure.kind);
      phase.current = 'error';
      setFrame({ identity, revision, state: { status: 'error', error: failure.kind, reconcile: uncertain.current } });
    };
    if (!config) fail(new StoryProjectsError('configuration'));
    else void Promise.resolve().then(async () => {
      if (!current()) return;
      const options = { baseUrl: config.baseUrl, projectId: selected.id, expectedLanguage: selected.language,
        getAccessToken: () => getAccessToken(owner), signal: controller.signal };
      // Every explicit attempt reconciles first. Never retry a write because a
      // timer fired, and never call the unconditional POST /sessions endpoint.
      const sessions = await listStorySessions(options);
      if (!current()) return;
      const existing = sessions.find(session => session.status === 'active');
      let state: ConversationState;
      if (!existing && reviewOnOpen && !sessions[0]) throw new StoryProjectsError('not-found');
      const reviewSession = reviewOnOpen ? existing ?? sessions[0] : existing;
      if (reviewSession) state = { status: 'ready', project: selected, session: reviewSession, resumed: true };
      else {
        // A first page can omit an older active session. The canonical RPC
        // searches all sessions under a project lock; absence here is not
        // treated as proof that a fresh session must be created.
        postStarted = true;
        const continued = await continueStoryProject(options);
        if (!current()) return;
        state = { status: 'ready', project: selected, session: continued.session, resumed: !continued.session_created };
      }
      if (!current()) return;
      uncertain.current = false;
      phase.current = 'ready';
      setFrame({ identity, revision, state });
      if (reviewOnOpen) setReviewIdentity(identity);
    }).catch(fail).finally(() => { if (current()) request.current = null; });
    return () => { alive.current = false; cancel(); };
  }, [identity, user.id, selected, config, getAccessToken, revision, cancel, reviewOnOpen]);

  const retry = () => {
    if (!alive.current || phase.current !== 'error' || blocked.current ||
      selection.current !== identity || latest.current !== identity) return;
    phase.current = 'loading';
    cancel();
    setRevision(value => value + 1);
  };
  const leave = useCallback((destination: () => void) => {
    const proceed = () => {
      phase.current = 'left';
      alive.current = false;
      cancel();
      setFrame(previous => ({ ...previous, state: { status: 'loading' } }));
      destination();
    };
    if (recording.current) recording.current.requestLeave(proceed);
    else proceed();
  }, [cancel]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (reviewIdentity === identity && !reviewOnOpen) setReviewIdentity(null);
      else leave(onBack);
      return true;
    });
    return () => listener.remove();
  }, [leave, onBack, reviewIdentity, identity, reviewOnOpen]);
  const state: ConversationState = frame.identity === identity && frame.revision === revision
    ? frame.state : { status: 'loading' };
  if (state.status === 'ready' && (reviewIdentity === identity || reviewOnOpen)) {
    return <MemoryReview language={language} title={selected.title} ownerId={user.id} projectId={selected.id}
      sessionId={state.session.id} sessionLanguage={state.session.language} baseUrl={config?.baseUrl ?? null}
      getAccessToken={getAccessToken} backLabel={reviewOnOpen ? backLabel ?? conversationCopy[language].back : undefined} onBack={() => { if (reviewOnOpen) leave(onBack); else setReviewIdentity(null); }} onSignOut={() => leave(onSignOut)} />;
  }
  const openReview = () => {
    if (state.status !== 'ready' || phase.current !== 'ready' || latest.current !== identity) return;
    const proceed = () => {
      if (alive.current && phase.current === 'ready' && latest.current === identity) setReviewIdentity(identity);
    };
    if (recording.current) recording.current.requestLeave(proceed);
    else proceed();
  };
  return <ConversationScreen language={language} state={state} onCheck={retry} onReviewMemories={openReview} backLabel={backLabel}
    recordingPanel={state.status === 'ready' ? <SessionRecording ref={recording} language={language}
      ownerId={user.id} projectId={selected.id} sessionId={state.session.id} sessionLanguage={state.session.language}
      baseUrl={config?.baseUrl ?? null} getAccessToken={getAccessToken} /> : undefined}
    onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
