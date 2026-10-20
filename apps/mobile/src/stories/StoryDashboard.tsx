import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../auth/client';
import { readMobileApiConfig } from '../api/config';
import { listStoryProjects, StoryProjectsError } from '../api/story-projects';
import type { Language } from '../i18n';
import { MyStoriesScreen, type MyStoriesState } from '../screens/MyStoriesScreen';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onCreateStory: () => void;
  onOpenStory?: (projectId: string) => void;
  onSignOut: () => void;
}

export function StoryDashboard({ language, user, getAccessToken, onCreateStory, onOpenStory, onSignOut }: Props) {
  // No settings or account data are persisted. A fresh verified account mounts
  // a fresh dashboard; a configuration change requires restarting Expo.
  const [config] = useState(readMobileApiConfig);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ owner: string; revision: number; state: MyStoriesState }>({
    owner: user.id, revision: 0, state: { status: 'loading' },
  });
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const owner = user.id;
    busy.current = true;
    if (!config) {
      busy.current = false;
      return () => { active = false; controller.abort(); };
    }
    void listStoryProjects({
      baseUrl: config.baseUrl,
      getAccessToken: () => getAccessToken(owner),
      signal: controller.signal,
    }).then(projects => {
      if (active && !controller.signal.aborted) setResult({ owner, revision, state: { status: 'ready', projects } });
    }).catch((error: unknown) => {
      if (active && !controller.signal.aborted) setResult({ owner, revision, state: {
        status: 'error', error: error instanceof StoryProjectsError ? error.kind : 'network',
      } });
    }).finally(() => { if (active) busy.current = false; });
    return () => { active = false; controller.abort(); };
  }, [user.id, getAccessToken, config, revision]);

  // Also fence a prop change during render, before effect cleanup can run.
  const state: MyStoriesState = !config ? { status: 'error', error: 'configuration' }
    : result.owner === user.id && result.revision === revision ? result.state : { status: 'loading' };
  return <MyStoriesScreen language={language} user={user} state={state} onCreateStory={onCreateStory} onOpenStory={onOpenStory} onSignOut={onSignOut}
    onRefresh={() => { if (!busy.current) { busy.current = true; setRevision(value => value + 1); } }} />;
}
