import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import type { AuthUser } from '../auth/client';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { storiesCopy } from '../stories-copy';
import { colors, headingFont, layout } from '../theme';

export type MyStoriesState =
  | { status: 'loading' }
  | { status: 'ready'; projects: StoryProject[] }
  | { status: 'error'; error: StoryProjectsErrorKind };

interface MyStoriesScreenProps {
  language: Language;
  user: AuthUser;
  state: MyStoriesState;
  onRefresh: () => void;
  onSignOut: () => void;
}

export function MyStoriesScreen({ language, user, state, onRefresh, onSignOut }: MyStoriesScreenProps) {
  const text = storiesCopy[language];
  const [refreshFocused, setRefreshFocused] = useState(false);
  const loading = state.status === 'loading';
  const refreshDisabled = loading || (state.status === 'error' && state.error === 'authentication');
  const projects = state.status === 'ready' ? state.projects.slice(0, 50) : [];

  return <Screen>
    <MemyBrand />
    <View style={screenStyles.section}>
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.title}</Text>
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
        style={screenStyles.description}>{text.introduction}</Text>
      <Text allowFontScaling selectable style={styles.identity}>{user.email}</Text>
    </View>
    <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel={loading ? text.refreshing : text.refresh}
        accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityState={{ disabled: refreshDisabled, busy: loading }} disabled={refreshDisabled}
        onPress={onRefresh} onFocus={() => setRefreshFocused(true)} onBlur={() => setRefreshFocused(false)}
        style={({ pressed }) => [styles.refresh, pressed && !refreshDisabled && styles.pressed,
          refreshFocused && styles.focused, refreshDisabled && styles.disabled]}>
        <Text allowFontScaling style={styles.refreshLabel}>{loading ? text.refreshing : text.refresh}</Text>
      </Pressable>
      <LargeButton label={text.signOut} language={language} onPress={onSignOut} />
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
            allowFontScaling style={screenStyles.footer}>{text.count(projects.length)}</Text>
          {projects.map((project) => {
            const storyLanguage = project.language === 'en' ? text.english : project.language === 'sv' ? text.swedish : text.otherLanguage;
            const title = project.title.trim();
            const storyLocale = title && (project.language === 'en' || project.language === 'sv')
              ? accessibilityLanguages[project.language] : accessibilityLanguages[language];
            // Only the project status established by the current contract is
            // translated. Session statuses and arbitrary server text stay out.
            const status = project.status === 'draft' ? text.draft : text.otherStatus;
            return <View key={project.id} style={styles.card}>
              <Text accessibilityRole="header" accessibilityLanguage={storyLocale}
                allowFontScaling style={styles.storyTitle}>{title || text.untitled}</Text>
              <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.detail}>
                {text.language}: {storyLanguage}
              </Text>
              <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.detail}>
                {text.status}: {status}
              </Text>
            </View>;
          })}
        </>)}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  heading: { fontFamily: headingFont },
  identity: { color: colors.ink, fontSize: 22, lineHeight: 32, textAlign: 'center', flexShrink: 1 },
  controls: { width: '100%', gap: 16 }, results: { width: '100%', gap: 20 },
  refresh: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius,
    backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  refreshLabel: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink }, disabled: { opacity: 0.65 },
  card: { width: '100%', gap: 12, padding: 20, borderWidth: 1, borderColor: colors.border,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
  detail: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  error: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 20, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
