import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AuthUser } from '../auth/client';
import { PreferenceLoading } from '../components/PreferenceLoading';
import { getStoryProject, validateStoryProjectId, type StoryProject } from '../api/story-projects';
import type { Language } from '../i18n';
import { CreateStory } from './CreateStory';
import { StoryDashboard } from './StoryDashboard';
import { StoryDetails } from './StoryDetails';
import { readMobileApiConfig } from '../api/config';
import { usePdfPrivacy } from '../exports/PdfPrivacy';
import { GenerateStory } from '../generation/GenerateStory';
import { Conversation } from './Conversation';
import { ConversationActionsProvider } from '../conversation/ConversationActions';
import { conversationCopy } from '../conversation-copy';
import { AuthenticatedShell } from '../navigation/AuthenticatedShell';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { RootTab } from '../root-navigation-copy';

interface Props {
  language: Language;
  user: AuthUser;
  getAccessToken: (expectedUserId: string) => Promise<string | null>;
  onSignOut: () => void;
  onSelectLanguage: (language: Language) => void;
  onReplayIntroduction: () => boolean | void;
  initialRootTab?: RootTab;
  consumeReplayReturn?: () => boolean;
}

type View = { kind: 'home' | 'list' | 'settings' | 'create' | 'inactive' | 'returning' }
  | { kind: 'details'; projectId: string }
  | { kind: 'conversation'; project: StoryProject; reviewOnOpen?: boolean; returnDraftId?: string }
  | { kind: 'generation'; project: StoryProject; initialDraftId?: string };
const isRoot = (view: View) => ['home', 'list', 'settings'].includes(view.kind);
const rootView = (tab: RootTab): View => ({ kind: tab === 'stories' ? 'list' : tab });

/** All private views remain in the original verified route and owner scope. */
export function StoriesHome(props: Props) {
  return <ConversationActionsProvider key={props.user.id} ownerId={props.user.id}>
    <StoryViews {...props} />
  </ConversationActionsProvider>;
}
function StoryViews(props: Props) {
  const [view, setView] = useState<View>(() => rootView(props.initialRootTab ?? 'home'));
  const currentView = useRef(view);
  const selectedGenerations = useRef(new Map<string, string>());
  const navigationEpoch = useRef(0), alive = useRef(true), focused = useRef(false);
  const restoration = useRef<AbortController | null>(null);
  useLayoutEffect(() => { currentView.current = view; }, [view]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; restoration.current?.abort(); };
  }, []);
  const publish = useCallback((next: View) => { currentView.current = next; setView(next); }, []);
  // Fence immediately, not just after React paints the next view. A captured
  // root action cannot discard a newly opened recorder, editor or memory review.
  const navigate = useCallback((from: View, next: View) => {
    if (!alive.current || !focused.current || currentView.current !== from) return;
    navigationEpoch.current++; restoration.current?.abort(); restoration.current = null;
    publish(next);
  }, [publish]);
  const { consumeReturn } = usePdfPrivacy();
  const { user, getAccessToken, consumeReplayReturn } = props;
  const restorePdfReturn = useCallback(() => {
    let active = true;
    const controller = new AbortController(), stamp = navigationEpoch.current;
    restoration.current = controller;
    void Promise.resolve().then(async () => {
      if (!active || !focused.current) return;
      const hint = consumeReturn(user.id);
      // Consume a superseded one-shot hint without making a request. It may
      // never override a later deliberate action, even before this microtask.
      if (!hint || !focused.current || stamp !== navigationEpoch.current) return;
      const config = readMobileApiConfig();
      if (!config) return;
      publish({ kind: 'returning' });
      try {
        const project = await getStoryProject({ baseUrl: config.baseUrl, projectId: hint.projectId,
          getAccessToken: () => getAccessToken(user.id), signal: controller.signal });
        if (active && focused.current && !controller.signal.aborted && stamp === navigationEpoch.current) {
          publish({ kind: 'generation', project, initialDraftId: hint.draftId });
        }
      } catch {
        if (active && focused.current && stamp === navigationEpoch.current) publish({ kind: 'home' });
      }
    });
    return () => {
      active = false; controller.abort();
      if (restoration.current === controller) restoration.current = null;
    };
  }, [consumeReturn, user.id, getAccessToken, publish]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const returned = consumeReplayReturn?.() === true;
    if (returned) publish({ kind: 'settings' });
    else if (currentView.current.kind === 'inactive') publish({ kind: 'home' });
    const cancelReturn = restorePdfReturn();
    // Blur still unmounts private views and cancels their work. Only a verified
    // internal replay return may restore Settings; no private text is retained.
    return () => {
      focused.current = false; navigationEpoch.current++; restoration.current?.abort();
      cancelReturn();
      publish({ kind: 'inactive' });
    };
  }, [consumeReplayReturn, publish, restorePdfReturn]));
  useEffect(() => {
    if (!isRoot(view) || view.kind === 'home') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!focused.current || currentView.current !== view) return false;
      navigate(view, { kind: 'home' }); return true;
    });
    return () => listener.remove();
  }, [view, navigate]);

  const showList = () => navigate(view, { kind: 'list' });
  const showCreate = () => navigate(view, { kind: 'create' });
  const showDetails = (value: string) => {
    try { navigate(view, { kind: 'details', projectId: validateStoryProjectId(value) }); }
    catch { /* Invalid selections never start a request or establish ownership. */ }
  };
  const signOut = () => {
    if (!alive.current || !focused.current || currentView.current !== view) return;
    focused.current = false; navigationEpoch.current++; restoration.current?.abort();
    props.onSignOut();
  };
  const scopedProps = { ...props, onSignOut: signOut };
  if (view.kind === 'inactive' || view.kind === 'returning') return <PreferenceLoading language={props.language} />;
  if (view.kind === 'create') return <CreateStory {...scopedProps} onBack={showList} />;
  if (view.kind === 'generation') return <GenerateStory {...scopedProps} project={view.project} initialDraftId={view.initialDraftId}
    onBack={() => showDetails(view.project.id)}
    onSelectionChange={draftId => {
      if (currentView.current !== view || !focused.current || !alive.current) return;
      try {
        const projectId = validateStoryProjectId(view.project.id), selectedId = validateStoryProjectId(draftId);
        const selections = selectedGenerations.current;
        if (!selections.has(projectId) && selections.size >= 200) {
          const oldest = selections.keys().next().value;
          if (oldest !== undefined) selections.delete(oldest);
        }
        selections.set(projectId, selectedId);
      } catch { /* Invalid/stale selections cannot replace a saved identity. */ }
    }}
    onContinueStory={draftId => navigate(view, { kind: 'conversation', project: view.project, returnDraftId: draftId })}
    onReviewMemories={draftId => navigate(view, { kind: 'conversation', project: view.project, reviewOnOpen: true,
      ...(draftId ? { returnDraftId: draftId } : {}) })} />;
  if (view.kind === 'conversation') return <Conversation key={view.project.id} {...scopedProps} project={view.project} reviewOnOpen={view.reviewOnOpen}
    backLabel={view.returnDraftId ? conversationCopy[props.language].returnAutobiography : undefined}
    onBack={() => {
      if (view.returnDraftId) navigate(view, { kind: 'generation', project: view.project, initialDraftId: view.returnDraftId });
      else showDetails(view.project.id);
    }} />;
  if (view.kind === 'details') return <StoryDetails key={view.projectId} {...scopedProps} projectId={view.projectId} onBack={showList}
    onConversation={project => navigate(view, { kind: 'conversation', project })}
    onReviewMemories={project => navigate(view, { kind: 'conversation', project, reviewOnOpen: true })}
    onGenerate={project => navigate(view, { kind: 'generation', project, initialDraftId: selectedGenerations.current.get(project.id) })} />;

  const tab: RootTab = view.kind === 'list' ? 'stories' : view.kind === 'settings' ? 'settings' : 'home';
  const selectTab = (next: RootTab) => {
    if (!['home', 'stories', 'settings'].includes(next) || !isRoot(currentView.current) || next === tab) return;
    navigate(view, rootView(next));
  };
  return <AuthenticatedShell language={props.language} tab={tab} onSelectTab={selectTab}>
    {view.kind === 'home' ? <HomeScreen language={props.language} onOpenStories={showList} onCreateStory={showCreate} />
      : view.kind === 'settings' ? <SettingsScreen language={props.language} user={user}
        onSelectLanguage={language => {
          if (alive.current && focused.current && currentView.current === view) props.onSelectLanguage(language);
        }}
        onReplayIntroduction={() => {
          if (!alive.current || !focused.current || currentView.current !== view) return;
          // Fence captured root actions before the native route loses focus.
          focused.current = false; navigationEpoch.current++; restoration.current?.abort();
          if (props.onReplayIntroduction() !== true) focused.current = true;
        }} onSignOut={signOut} />
        // Fresh list read after leaving Create; never insert a POST response or
        // keep another project cache in Home.
        : <StoryDashboard {...scopedProps} root onCreateStory={showCreate} onOpenStory={showDetails} />}
  </AuthenticatedShell>;
}
