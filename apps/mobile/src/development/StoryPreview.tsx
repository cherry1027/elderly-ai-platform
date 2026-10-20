import { useEffect, useState } from 'react';
import { AppState, BackHandler, Keyboard, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject } from '../api/story-projects';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { CreateStoryScreen, type CreateStoryState } from '../screens/CreateStoryScreen';
import { EditStoryScreen, type EditStoryState } from '../screens/EditStoryScreen';
import { MyStoriesScreen } from '../screens/MyStoriesScreen';
import { StoryDetailsScreen } from '../screens/StoryDetailsScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { LanguageScreen } from '../screens/LanguageScreen';
import { IntroductionScreen } from '../screens/IntroductionScreen';
import type { IntroScene } from '../intro-copy';
import { colors } from '../theme';
import { readStoryPreviewEnabled } from './story-preview-config';

const examples: StoryProject[] = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'A made-up summer memory', description: 'An invented example for testing.\nNo personal story is stored here.',
    language: 'en', status: 'draft', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Ett påhittat sommarminne', description: 'Ett påhittat exempel för testning.\nIngen personlig berättelse sparas här.',
    language: 'sv', status: 'future-status', created_at: '2026-10-19T12:00:00Z', updated_at: '2026-10-19T12:00:00Z' },
];
const copy = {
  en: { banner: 'SAMPLE STORIES. Nothing is saved.', account: 'Sample account', exit: 'Exit Preview / Return to Welcome', open: 'View sample stories' },
  sv: { banner: 'EXEMPELBERÄTTELSER. Inget sparas.', account: 'Exempelkonto', exit: 'Lämna förhandsvisningen / Till Välkommen', open: 'Visa exempelberättelser' },
};
type ViewState = { kind: 'welcome' | 'language' | 'list' | 'create' }
  | { kind: 'introduction'; scene: IntroScene } | { kind: 'details' | 'edit'; id: string };

/** Pure local samples: no account providers, transports or persistence. */
export function StoryPreview() {
  const [language, setLanguage] = useState<Language>('en');
  const [view, setView] = useState<ViewState>({ kind: 'welcome' });
  const [create, setCreate] = useState<CreateStoryState>({ status: 'idle' });
  const [edit, setEdit] = useState<EditStoryState>({ status: 'idle' });
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        setView({ kind: 'welcome' });
        setCreate({ status: 'idle' }); setEdit({ status: 'idle' });
      }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view.kind === 'welcome') return false;
      Keyboard.dismiss();
      if (view.kind === 'edit') setView({ kind: 'details', id: view.id });
      else if (view.kind === 'create' || view.kind === 'details') setView({ kind: 'list' });
      else if (view.kind === 'introduction' && view.scene > 0) setView({ kind: 'introduction', scene: (view.scene - 1) as IntroScene });
      else setView({ kind: 'welcome' });
      setCreate({ status: 'idle' }); setEdit({ status: 'idle' });
      return true;
    });
    return () => listener.remove();
  }, [view]);
  if (!readStoryPreviewEnabled()) return null;
  const text = copy[language];
  const project = 'id' in view ? examples.find(row => row.id === view.id) : undefined;
  const close = () => { Keyboard.dismiss(); setView({ kind: 'welcome' }); setCreate({ status: 'idle' }); setEdit({ status: 'idle' }); };
  const list = () => setView({ kind: 'list' });
  let content;
  if (view.kind === 'welcome') content = <WelcomeScreen language={language}
    primaryAction={{ label: text.open, onPress: list }} onChangeLanguage={() => setView({ kind: 'language' })}
    onReplayIntroduction={() => setView({ kind: 'introduction', scene: 0 })} />;
  else if (view.kind === 'language') content = <LanguageScreen language={language} onSelectLanguage={setLanguage}
    onContinue={close} onBack={close} />;
  else if (view.kind === 'introduction') content = <IntroductionScreen key={view.scene} language={language} scene={view.scene}
    onNext={() => { if (view.scene < 2) setView({ kind: 'introduction', scene: (view.scene + 1) as IntroScene }); }}
    onBack={() => view.scene > 0 ? setView({ kind: 'introduction', scene: (view.scene - 1) as IntroScene }) : close()}
    onSkip={close} onEnter={close} />;
  else if (view.kind === 'create') content = <CreateStoryScreen language={language} state={create} serviceAvailable={false}
    onSubmit={() => setCreate({ status: 'error', error: 'configuration', uncertain: false })} onBack={list} onSignOut={close} />;
  else if (view.kind === 'edit' && project) content = <EditStoryScreen key={project.id} language={language} project={project} state={edit}
    onSubmit={() => setEdit({ status: 'error', error: 'configuration', uncertain: false })}
    onBack={() => setView({ kind: 'details', id: project.id })} onSignOut={close} />;
  else if (view.kind === 'details' && project) content = <StoryDetailsScreen language={language} state={{ status: 'ready', project }}
    onEdit={() => { setEdit({ status: 'idle' }); setView({ kind: 'edit', id: project.id }); }}
    onRefresh={() => {}} onBack={list} onSignOut={close} />;
  else content = <MyStoriesScreen language={language} user={{ id: 'sample-only', email: text.account }} state={{ status: 'ready', projects: examples }}
    onRefresh={() => {}} onCreateStory={() => { setCreate({ status: 'idle' }); setView({ kind: 'create' }); }}
    onOpenStory={id => setView({ kind: 'details', id })} onSignOut={close} />;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
    <View style={styles.banner}>
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{text.banner}</Text>
      {view.kind !== 'welcome' && <LargeButton label={text.exit} language={language} variant="secondary" onPress={close} />}
    </View>
    <View style={styles.content}>{content}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream }, banner: { padding: 12, gap: 8, borderBottomWidth: 2, borderColor: colors.forest },
  notice: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  content: { flex: 1 },
});
