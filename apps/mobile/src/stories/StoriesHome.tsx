import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { AuthUser } from '../auth/client';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { validateStoryProjectId } from '../api/story-projects';
import type { Language } from '../i18n';
import { CreateStory } from './CreateStory';
import { StoryDashboard } from './StoryDashboard';
import { StoryDetails } from './StoryDetails';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onSignOut: () => void;
}

type View = { kind: 'list' | 'create' | 'inactive' } | { kind: 'details'; projectId: string };

/** Native views stay inside the existing verified authenticated route. */
export function StoriesHome(props: Props) {
  const [view, setView] = useState<View>({ kind: 'list' });
  useFocusEffect(useCallback(() => {
    setView(current => current.kind === 'inactive' ? { kind: 'list' } : current);
    // A stacked route can lose focus without unmounting. Drop the form/list so
    // their requests and private state cannot survive navigation elsewhere.
    return () => setView({ kind: 'inactive' });
  }, []));
  const showList = useCallback(() => setView({ kind: 'list' }), []);
  const showCreate = useCallback(() => setView({ kind: 'create' }), []);
  const showDetails = useCallback((value: string) => {
    try { setView({ kind: 'details', projectId: validateStoryProjectId(value) }); }
    catch { /* An invalid selection cannot start a request or claim ownership. */ }
  }, []);
  if (view.kind === 'inactive') return <PreferenceLoading language={props.language} />;
  if (view.kind === 'create') return <CreateStory {...props} onBack={showList} />;
  if (view.kind === 'details') return <StoryDetails key={view.projectId} {...props} projectId={view.projectId} onBack={showList} />;
  // Always ask the server for the list after leaving Create. Never insert the
  // POST response optimistically or fabricate a saved dashboard row.
  return <StoryDashboard {...props} onCreateStory={showCreate} onOpenStory={showDetails} />;
}
