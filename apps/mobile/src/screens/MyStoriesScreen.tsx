import { useState } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import type { AuthUser } from '../auth/client';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { storiesCopy } from '../stories-copy';
import { colors, headingFont, layout } from '../theme';
import { RootScreenHeading } from '../navigation/AuthenticatedShell';
import { rootNavigationCopy } from '../root-navigation-copy';

export type MyStoriesState =
  | { status: 'loading' }
  | { status: 'ready'; projects: StoryProject[] }
  | { status: 'error'; error: StoryProjectsErrorKind };

interface MyStoriesScreenProps {
  language: Language;
  user: AuthUser;
  state: MyStoriesState;
  onRefresh: () => void;
  onCreateStory: () => void;
  onOpenStory?: (projectId: string) => void;
  onSignOut: () => void;
  root?: boolean;
}

export function MyStoriesScreen({ language, user, state, onRefresh, onCreateStory, onOpenStory, onSignOut, root = false }: MyStoriesScreenProps) {
  const text = storiesCopy[language];
  const { waiting } = useApiBackoff();
  const [refreshFocused, setRefreshFocused] = useState(false);
  const [createFocused, setCreateFocused] = useState(false);
  const loading = state.status === 'loading';
  const authenticationFailed = state.status === 'error' && state.error === 'authentication';
  const refreshDisabled = waiting || loading || authenticationFailed;
  const projects = state.status === 'ready' ? state.projects.slice(0, 50) : [];

  return <Screen working={root}>
    {!root && <MemyBrand />}
    <View style={[screenStyles.section, root && styles.rootSection]}>
      {root ? <RootScreenHeading language={language} title={text.title} /> : <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.title}</Text>}
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
        style={[screenStyles.description, root && styles.rootIntroduction]}>{root ? text.rootIntroduction : text.introduction}</Text>
      {!root && <Text allowFontScaling selectable style={styles.identity}>{user.email}</Text>}
    </View>
    <View style={[styles.controls, root && styles.rootControls]}>
      <Pressable accessibilityRole="button" accessibilityLabel={text.createStory}
        accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityState={{ disabled: authenticationFailed }} disabled={authenticationFailed}
        onPress={() => { if (!authenticationFailed) onCreateStory(); }}
        onFocus={() => setCreateFocused(true)} onBlur={() => setCreateFocused(false)}
        style={({ pressed }) => [styles.refresh, root && styles.rootCreate, styles.create, pressed && !authenticationFailed && styles.createPressed,
          createFocused && styles.focused, authenticationFailed && styles.disabled]}>
        <Text allowFontScaling style={[styles.refreshLabel, styles.createLabel]}>{text.createStory}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={loading ? text.refreshing : text.refresh}
        accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityState={{ disabled: refreshDisabled, busy: loading }} disabled={refreshDisabled}
        onPress={() => { if (!refreshDisabled) onRefresh(); }} onFocus={() => setRefreshFocused(true)} onBlur={() => setRefreshFocused(false)}
        style={({ pressed }) => [styles.refresh, root && styles.rootRefresh, pressed && !refreshDisabled && styles.pressed,
          refreshFocused && styles.focused, refreshDisabled && styles.disabled]}>
        <Text allowFontScaling style={[styles.refreshLabel, root && styles.rootRefreshLabel]}>{loading ? text.refreshing : text.refresh}</Text>
      </Pressable>
      {!root && <LargeButton label={text.signOut} language={language} onPress={onSignOut} />}
    </View>
    <View style={styles.results} accessibilityState={{ busy: loading }}>
      {loading && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={screenStyles.description}>{text.loading}</Text>}
      {state.status === 'error' && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
        accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.error}>{text.errors[state.error]}</Text>}
      {state.status === 'ready' && (projects.length === 0
        ? <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={screenStyles.description}>{text.empty}</Text>
        : <>
          <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={[screenStyles.footer, root && styles.rootCount]}>{root ? text.rootCount(projects.length) : text.count(projects.length)}</Text>
          {projects.map((project) => {
            const storyLanguage = project.language === 'en' ? text.english : project.language === 'sv' ? text.swedish : text.otherLanguage;
            const title = project.title.trim();
            const storyLocale = title && (project.language === 'en' || project.language === 'sv')
              ? accessibilityLanguages[project.language] : accessibilityLanguages[language];
            // Only the project status established by the current contract is
            // translated. Session statuses and arbitrary server text stay out.
            const status = project.status === 'draft' ? text.draft : text.otherStatus;
            return <View key={project.id} style={[styles.card, root && styles.rootCard]}>
              <Text accessibilityRole="header" accessibilityLanguage={storyLocale}
                allowFontScaling style={[styles.storyTitle, root && styles.rootStoryTitle]}>{title || text.untitled}</Text>
              {root ? <View style={styles.rootMetadata}>
                <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={[styles.detail, styles.rootDetail]}>
                  {text.language}: {storyLanguage}
                </Text>
                <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={[styles.detail, styles.rootDetail]}>
                  {text.status}: {status}
                </Text>
              </View> : <>
                <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.detail}>
                  {text.language}: {storyLanguage}
                </Text>
                <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.detail}>
                  {text.status}: {status}
                </Text>
              </>}
              {onOpenStory && <LargeButton label={root ? rootNavigationCopy[language].openStory : `${text.openStory}: ${title || text.untitled}`}
                accessibilityLabel={`${text.openStory}: ${title || text.untitled}`} language={language} variant={root ? 'secondary' : 'primary'} density={root ? 'compact' : 'comfortable'}
                onPress={() => onOpenStory(project.id)} />}
            </View>;
          })}
        </>)}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  rootSection: { alignItems: 'stretch', gap: 10 },
  rootIntroduction: { textAlign: 'left', fontSize: 21, lineHeight: 31 },
  rootControls: { gap: 6 },
  rootCreate: { paddingVertical: 12, paddingHorizontal: 20 },
  rootRefresh: { width: 'auto', alignSelf: 'flex-start', borderColor: 'transparent',
    backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 10 },
  rootRefreshLabel: { fontSize: 20, lineHeight: 30, textDecorationLine: 'underline', fontWeight: '500' },
  rootCount: { textAlign: 'left', fontSize: 19, lineHeight: 28 },
  rootCard: { padding: 18, gap: 10 },
  rootStoryTitle: { fontSize: 26, lineHeight: 36 },
  rootMetadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 4 },
  rootDetail: { color: colors.muted, fontSize: 19, lineHeight: 28, maxWidth: '100%' },
  heading: { fontFamily: headingFont },
  identity: { color: colors.ink, fontSize: 22, lineHeight: 32, textAlign: 'center', flexShrink: 1 },
  controls: { width: '100%', gap: 16 }, results: { width: '100%', gap: 20 },
  refresh: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius,
    backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  refreshLabel: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  create: { backgroundColor: colors.forest }, createLabel: { color: colors.paper },
  createPressed: { backgroundColor: colors.forestPressed, borderColor: colors.forestPressed },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink }, disabled: { opacity: 0.65 },
  card: { width: '100%', gap: 12, padding: 20, borderWidth: 1, borderColor: colors.border,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
  detail: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  error: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 20, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
