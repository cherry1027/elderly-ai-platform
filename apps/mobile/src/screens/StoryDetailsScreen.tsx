import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { storyDetailsCopy } from '../story-details-copy';
import { colors, headingFont, layout } from '../theme';

export type StoryDetailsState =
  | { status: 'loading' }
  | { status: 'ready'; project: StoryProject; saved?: boolean }
  | { status: 'error'; error: StoryProjectsErrorKind };

interface Props {
  language: Language;
  state: StoryDetailsState;
  onEdit: () => void;
  onRefresh: () => void;
  onBack: () => void;
  onSignOut: () => void;
  onConversation?: () => void;
  onGenerate?: () => void;
}

export function StoryDetailsScreen({ language, state, onEdit, onRefresh, onBack, onSignOut, onConversation, onGenerate }: Props) {
  const text = storyDetailsCopy[language];
  const message = state.status === 'error' ? text.errors[state.error]
    : state.status === 'ready' && state.saved ? text.saved : null;
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  const locale = accessibilityLanguages[language];
  return <Screen>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.title}</Text>
    <View style={styles.details} accessibilityState={{ busy: state.status === 'loading' }}>
      {state.status === 'loading' && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
        allowFontScaling style={styles.body}>{text.loading}</Text>}
      {state.status === 'error' && <Text accessibilityRole="alert" accessibilityLanguage={locale}
        accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
        allowFontScaling style={styles.notice}>{text.errors[state.error]}</Text>}
      {state.status === 'ready' && <>
        {state.saved && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
          allowFontScaling style={styles.notice}>{text.saved}</Text>}
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[state.project.language]}
          allowFontScaling selectable style={styles.title}>{state.project.title.trim() || text.untitled}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
          {text.language}: {state.project.language === 'sv' ? text.swedish : text.english}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
          {text.status}: {state.project.status === 'draft' ? text.draft : text.otherStatus}
        </Text>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.description}</Text>
        <Text accessibilityLanguage={state.project.description ? accessibilityLanguages[state.project.language] : locale}
          allowFontScaling selectable style={styles.body}>{state.project.description || text.noDescription}</Text>
        {onGenerate && <LargeButton label={text.generate} language={language} onPress={onGenerate} />}
        <LargeButton label={text.edit} language={language} variant={onGenerate ? 'secondary' : 'primary'} onPress={onEdit} />
        {onConversation && <LargeButton label={text.conversation} language={language} variant={onGenerate ? 'secondary' : 'primary'} onPress={onConversation} />}
      </>}
      {state.status !== 'loading' && !(state.status === 'error' && state.error === 'authentication') &&
        <LargeButton label={text.refresh} language={language} variant="secondary" onPress={onRefresh} />}
      <LargeButton label={text.back} language={language} variant="secondary" onPress={onBack} />
      <LargeButton label={text.signOut} language={language} variant="secondary" onPress={onSignOut} />
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  details: { width: '100%', gap: 24 },
  title: { color: colors.ink, fontFamily: headingFont, fontSize: 32, lineHeight: 42, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600' },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
