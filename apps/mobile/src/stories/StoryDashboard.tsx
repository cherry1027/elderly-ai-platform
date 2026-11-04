import type { AuthUser } from '../auth/client';
import type { Language } from '../i18n';
import { MyStoriesScreen } from '../screens/MyStoriesScreen';
import { useStoryProjects, type StoryProjectsController } from './useStoryProjects';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onCreateStory: () => void;
  onOpenStory?: (projectId: string) => void;
  onSignOut: () => void;
  root?: boolean;
  controller?: StoryProjectsController;
}

export function StoryDashboard({ language, user, getAccessToken, onCreateStory, onOpenStory, onSignOut, root = false, controller }: Props) {
  // Standalone/sample consumers keep the same verified local controller.
  const local = useStoryProjects({ owner: user.id, getAccessToken, enabled: !controller });
  const { state, refresh } = controller ?? local;
  return <MyStoriesScreen language={language} user={user} state={state} root={root} onCreateStory={onCreateStory}
    onOpenStory={onOpenStory} onSignOut={onSignOut} onRefresh={refresh} />;
}
