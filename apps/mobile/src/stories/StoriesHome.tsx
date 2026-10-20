import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { AuthUser } from '../auth/client';
import { PreferenceLoading } from '../components/PreferenceLoading';
import type { Language } from '../i18n';
import { CreateStory } from './CreateStory';
import { StoryDashboard } from './StoryDashboard';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onSignOut: () => void;
}

/** Both native views stay inside the existing verified authenticated route. */
export function StoriesHome(props: Props) {
  const [view, setView] = useState<'list' | 'create' | 'inactive'>('list');
  useFocusEffect(useCallback(() => {
    setView(current => current === 'inactive' ? 'list' : current);
    // A stacked route can lose focus without unmounting. Drop the form/list so
    // their requests and private state cannot survive navigation elsewhere.
    return () => setView('inactive');
  }, []));
  const showList = useCallback(() => setView('list'), []);
  const showCreate = useCallback(() => setView('create'), []);
  if (view === 'inactive') return <PreferenceLoading language={props.language} />;
  if (view === 'create') return <CreateStory {...props} onBack={showList} />;
  // Always ask the server for the list after leaving Create. Never insert the
  // POST response optimistically or fabricate a saved dashboard row.
  return <StoryDashboard {...props} onCreateStory={showCreate} />;
}
