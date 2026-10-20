import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { AuthUser } from '../auth/client';
import { readMobileApiConfig } from '../api/config';
import { createStoryProject, StoryProjectsError, validateCreateStoryInput, type CreateStoryProjectInput } from '../api/story-projects';
import type { Language } from '../i18n';
import { CreateStoryScreen, type CreateStoryState } from '../screens/CreateStoryScreen';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onBack: () => void;
  onSignOut: () => void;
}

export function CreateStory({ language, user, getAccessToken, onBack, onSignOut }: Props) {
  const [config] = useState(readMobileApiConfig);
  const [result, setResult] = useState<{ owner: string; state: CreateStoryState }>({ owner: user.id, state: { status: 'idle' } });
  const alive = useRef(false);
  const generation = useRef(0);
  const working = useRef(false);
  const finished = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    working.current = false;
    finished.current = false;
    return () => {
      alive.current = false;
      generation.current += 1;
      request.current?.abort();
      request.current = null;
    };
  }, [user.id]);

  const leave = useCallback((destination: () => void) => {
    generation.current += 1;
    finished.current = true;
    request.current?.abort();
    request.current = null;
    destination();
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { leave(onBack); return true; });
    return () => listener.remove();
  }, [leave, onBack]);

  function submit(value: CreateStoryProjectInput) {
    if (!alive.current || working.current || finished.current) return;
    let input: CreateStoryProjectInput;
    try { input = validateCreateStoryInput(value); }
    catch { setResult({ owner: user.id, state: { status: 'error', error: 'validation', uncertain: false } }); return; }
    if (!config) {
      setResult({ owner: user.id, state: { status: 'error', error: 'configuration', uncertain: false } });
      return;
    }
    const owner = user.id;
    const attempt = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    working.current = true;
    setResult({ owner, state: { status: 'saving' } });
    const current = () => alive.current && generation.current === attempt && !controller.signal.aborted;
    void createStoryProject({ baseUrl: config.baseUrl, input, getAccessToken: () => getAccessToken(owner), signal: controller.signal })
      .then(project => {
        if (!current()) return;
        finished.current = true;
        setResult({ owner, state: { status: 'success', project } });
      }).catch((error: unknown) => {
        if (!current()) return;
        const failure = error instanceof StoryProjectsError ? error : new StoryProjectsError('network', undefined, true);
        finished.current = failure.mayHaveCreated || failure.kind === 'authentication';
        setResult({ owner, state: { status: 'error', error: failure.kind, uncertain: failure.mayHaveCreated } });
      }).finally(() => {
        if (current()) { working.current = false; request.current = null; }
      });
  }

  // Account changes are fenced in render, before the previous effect cleans up.
  const state: CreateStoryState = result.owner === user.id ? result.state : { status: 'idle' };
  return <CreateStoryScreen key={user.id} language={language} state={state} serviceAvailable={Boolean(config)}
    onSubmit={submit} onBack={() => leave(onBack)} onSignOut={() => leave(onSignOut)} />;
}
