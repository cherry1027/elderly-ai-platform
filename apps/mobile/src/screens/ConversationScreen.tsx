import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { conversationCopy } from '../conversation-copy';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';

export type ConversationState =
  | { status: 'loading' }
  | { status: 'ready'; project: Pick<StoryProject, 'title' | 'language'>;
    session: { id: string; language: 'en' | 'sv' }; resumed: boolean }
  | { status: 'error'; error: StoryProjectsErrorKind; reconcile?: boolean };

interface Props {
  language: Language;
  state: ConversationState;
  onCheck: () => void;
  onBack: () => void;
  onSignOut: () => void;
  recordingPanel?: ReactNode;
  onReviewMemories?: () => void;
}

/** A verified-session landing screen, with an optional authenticated audio panel. */
export function ConversationScreen({ language, state, onCheck, onBack, onSignOut, recordingPanel, onReviewMemories }: Props) {
  const text = conversationCopy[language];
  const locale = accessibilityLanguages[language];
  const message = state.status === 'error' ? [text.errors[state.error], state.reconcile && text.uncertain].filter(Boolean).join(' ')
    : state.status === 'ready' ? text.ready : text.loading;
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return <Screen>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling
      style={screenStyles.heading}>{text.title}</Text>
    <View style={styles.details} accessibilityState={{ busy: state.status === 'loading' }}>
      {state.status === 'loading' && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
        allowFontScaling style={styles.body}>{text.loading}</Text>}
      {state.status === 'error' && <>
        <Text accessibilityRole="alert" accessibilityLanguage={locale}
          accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
          allowFontScaling style={styles.notice}>{text.errors[state.error]}</Text>
        {state.reconcile && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.uncertain}</Text>}
        {!['configuration', 'authentication', 'forbidden', 'not-found', 'validation'].includes(state.error) &&
          <LargeButton label={text.check} language={language} onPress={onCheck} />}
      </>}
      {state.status === 'ready' && <>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[state.project.language]}
          allowFontScaling selectable style={styles.title}>{state.project.title}</Text>
        <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale} allowFontScaling
          style={styles.notice}>{text.ready}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{state.resumed ? text.resumed : text.started}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
          {text.language}: {state.session.language === 'sv' ? text.swedish : text.english}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.scope}</Text>
        {onReviewMemories && <LargeButton label={text.review} language={language} onPress={onReviewMemories} />}
        {recordingPanel}
      </>}
      <LargeButton label={text.back} language={language} variant="secondary" onPress={onBack} />
      <LargeButton label={text.signOut} language={language} variant="secondary" onPress={onSignOut} />
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  details: { width: '100%', gap: 24 },
  title: { color: colors.ink, fontFamily: headingFont, fontSize: 32, lineHeight: 42, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
