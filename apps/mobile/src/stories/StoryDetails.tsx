import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { AuthUser } from '../auth/client';
import { readMobileApiConfig } from '../api/config';
import {
  getStoryProject, updateStoryProject, validateStoryProjectId, validateUpdateStoryInput,
  StoryProjectsError, type StoryProject, type UpdateStoryProjectInput,
} from '../api/story-projects';
import type { Language } from '../i18n';
import { StoryDetailsScreen, type StoryDetailsState } from '../screens/StoryDetailsScreen';
import { EditStoryScreen, type EditStoryState } from '../screens/EditStoryScreen';

interface Props {
  language: Language;
  user: AuthUser;
  projectId: string;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onBack: () => void;
  onSignOut: () => void;
  onConversation?: (project: StoryProject) => void;
}
type Frame = {
  owner: string; projectId: string | null; revision: number;
  details: StoryDetailsState; editing: boolean; edit: EditStoryState;
};
type Phase = 'loading' | 'details' | 'details-error' | 'editing' | 'saving' | 'edit-blocked' | 'left';

export function StoryDetails({ language, user, projectId: rawId, getAccessToken, onBack, onSignOut, onConversation }: Props) {
  const projectId = useMemo(() => { try { return validateStoryProjectId(rawId); } catch { return null; } }, [rawId]);
  const [config] = useState(readMobileApiConfig);
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState<Frame>({ owner: user.id, projectId, revision: 0,
    details: { status: 'loading' }, editing: false, edit: { status: 'idle' } });
  const alive = useRef(false);
  const generation = useRef(0);
  const phase = useRef<Phase>('loading');
  const authenticationBlocked = useRef(false);
  const selection = useRef({ owner: user.id, projectId });
  const request = useRef<AbortController | null>(null);
  const cancelRequest = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (phase.current === 'left') return;
    if (selection.current.owner !== user.id || selection.current.projectId !== projectId) authenticationBlocked.current = false;
    selection.current = { owner: user.id, projectId };
    alive.current = true;
    phase.current = 'loading';
    const attempt = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    const owner = user.id;
    const current = () => alive.current && generation.current === attempt && !controller.signal.aborted;
    if (config && projectId) {
      void Promise.resolve().then(async () => {
        if (!current()) return;
        const project = await getStoryProject({ baseUrl: config.baseUrl, projectId,
          getAccessToken: () => getAccessToken(owner), signal: controller.signal });
        if (!current()) return;
        phase.current = 'details';
        setFrame({ owner, projectId, revision, details: { status: 'ready', project }, editing: false, edit: { status: 'idle' } });
      }).catch((error: unknown) => {
        if (!current()) return;
        const kind = error instanceof StoryProjectsError ? error.kind : 'network';
        authenticationBlocked.current = kind === 'authentication';
        phase.current = 'details-error';
        setFrame({ owner, projectId, revision, details: { status: 'error', error: kind }, editing: false, edit: { status: 'idle' } });
      }).finally(() => { if (current()) request.current = null; });
    } else phase.current = 'details-error';
    return () => { alive.current = false; cancelRequest(); };
  }, [user.id, projectId, config, getAccessToken, revision, cancelRequest]);

  const reload = useCallback(() => {
    if (!alive.current || phase.current === 'left') return;
    cancelRequest();
    if (authenticationBlocked.current) {
      phase.current = 'details-error';
      setFrame({ owner: user.id, projectId, revision, details: { status: 'error', error: 'authentication' },
        editing: false, edit: { status: 'idle' } });
      return;
    }
    phase.current = 'loading';
    setRevision(value => value + 1);
  }, [cancelRequest, user.id, projectId, revision]);
  const leave = useCallback((destination: () => void) => {
    phase.current = 'left';
    alive.current = false;
    cancelRequest();
    setFrame(previous => ({ ...previous, details: { status: 'loading' }, editing: false, edit: { status: 'idle' } }));
    destination();
  }, [cancelRequest]);

  const matching = frame.owner === user.id && frame.projectId === projectId && frame.revision === revision;
  const details: StoryDetailsState = !projectId ? { status: 'error', error: 'validation' }
    : !config ? { status: 'error', error: 'configuration' } : matching ? frame.details : { status: 'loading' };
  const editing = matching && frame.editing && details.status === 'ready';
  const back = useCallback(() => {
    if (editing) reload();
    else leave(onBack);
  }, [editing, reload, leave, onBack]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [back]);

  function beginEdit() {
    if (!alive.current || phase.current !== 'details' || !matching || details.status !== 'ready' ||
        selection.current.owner !== user.id || selection.current.projectId !== projectId) return;
    phase.current = 'editing';
    setFrame(previous => ({ ...previous, editing: true, edit: { status: 'idle' } }));
  }
  function save(value: UpdateStoryProjectInput) {
    if (!alive.current || phase.current !== 'editing' || !matching || details.status !== 'ready' ||
        selection.current.owner !== user.id || selection.current.projectId !== projectId) return;
    let input: UpdateStoryProjectInput;
    try { input = validateUpdateStoryInput(value); }
    catch {
      setFrame(previous => ({ ...previous, edit: { status: 'error', error: 'validation', uncertain: false } }));
      return;
    }
    if (!config || !projectId) return;
    const owner = user.id;
    const expectedLanguage = details.project.language;
    const attempt = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    phase.current = 'saving';
    setFrame(previous => ({ ...previous, edit: { status: 'saving' } }));
    const current = () => alive.current && generation.current === attempt && !controller.signal.aborted;
    void Promise.resolve().then(async () => {
      if (!current()) return;
      const project = await updateStoryProject({ baseUrl: config.baseUrl, projectId, input, expectedLanguage,
        getAccessToken: () => getAccessToken(owner), signal: controller.signal });
      if (!current()) return;
      phase.current = 'details';
      setFrame({ owner, projectId, revision, details: { status: 'ready', project, saved: true }, editing: false, edit: { status: 'idle' } });
    }).catch((error: unknown) => {
      if (!current()) return;
      const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
      authenticationBlocked.current = failure.kind === 'authentication';
      phase.current = failure.mayHaveWritten || authenticationBlocked.current ? 'edit-blocked' : 'editing';
      setFrame(previous => ({ ...previous, edit: { status: 'error', error: failure.kind, uncertain: failure.mayHaveWritten } }));
    }).finally(() => { if (current()) request.current = null; });
  }

  function beginConversation() {
    if (!onConversation || !alive.current || phase.current !== 'details' || !matching || details.status !== 'ready' ||
        selection.current.owner !== user.id || selection.current.projectId !== projectId) return;
    leave(() => onConversation(details.project));
  }

  if (editing && details.status === 'ready') return <EditStoryScreen key={`${user.id}:${projectId}`} language={language}
    project={details.project} state={frame.edit} onSubmit={save} onBack={reload} onSignOut={() => leave(onSignOut)} />;
  return <StoryDetailsScreen language={language} state={details} onEdit={beginEdit}
    onConversation={onConversation ? beginConversation : undefined}
    onRefresh={() => { if (phase.current === 'details' || phase.current === 'details-error') reload(); }}
    onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
