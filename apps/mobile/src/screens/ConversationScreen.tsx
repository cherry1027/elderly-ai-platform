import { useEffect, type ReactNode } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { AccountAction } from '../components/AccountPresentation';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { StoryHeading } from '../components/StoryPresentation';
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
  backLabel?: string;
}

/** A verified-session landing screen, with an optional authenticated audio panel. */
export function ConversationScreen({ language, state, onCheck, onBack, onSignOut, recordingPanel, onReviewMemories, backLabel }: Props) {
  const text = conversationCopy[language];
  const { waiting } = useApiBackoff();
  const locale = accessibilityLanguages[language];
  const message = state.status === 'error' ? [text.errors[state.error], state.reconcile && text.uncertain].filter(Boolean).join(' ')
    : state.status === 'ready' ? text.ready : text.loading;
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return <Screen><View style={styles.workspace}>
    <StoryHeading language={language} title={text.title} />
    <View style={styles.details} accessibilityState={{ busy: state.status === 'loading' }}>
      {state.status === 'loading' && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
        allowFontScaling style={styles.body}>{text.loading}</Text>}
      {state.status === 'error' && <>
        <Text accessibilityRole="alert" accessibilityLanguage={locale}
          accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
          allowFontScaling style={styles.notice}>{text.errors[state.error]}</Text>
        {state.reconcile && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.uncertain}</Text>}
        {!['configuration', 'authentication', 'forbidden', 'not-found', 'validation'].includes(state.error) &&
          <LargeButton label={text.check} language={language} disabled={waiting} onPress={onCheck} />}
      </>}
      {state.status === 'ready' && <>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[state.project.language]}
          allowFontScaling selectable style={styles.title}>{state.project.title}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>
          {text.language}: {state.session.language === 'sv' ? text.swedish : text.english}
        </Text>
        {recordingPanel}
        <View style={styles.sessionDetails}>
          <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale} allowFontScaling
            style={styles.metadata}>{text.ready}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>{state.resumed ? text.resumed : text.started}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>{text.scope}</Text>
        </View>
        {onReviewMemories && <LargeButton label={text.review} language={language} variant="secondary" density="compact" onPress={onReviewMemories} />}
      </>}
      <LargeButton label={backLabel ?? text.back} language={language} variant="secondary" density="compact" onPress={onBack} />
      <AccountAction label={text.signOut} language={language} quiet onPress={onSignOut} />
    </View>
  </View></Screen>;
}

const styles = StyleSheet.create({
  workspace: { width: '100%', flexGrow: 1, gap: 20 },
  details: { width: '100%', gap: 18 },
  title: { color: colors.ink, fontFamily: headingFont, fontSize: 27, lineHeight: 37, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  metadata: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
  sessionDetails: { gap: 6, paddingVertical: 8 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
