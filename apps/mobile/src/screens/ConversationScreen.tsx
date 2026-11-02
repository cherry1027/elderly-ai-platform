import { useEffect, type ReactNode } from 'react';
import { ApiBackoffBanner, useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { AccountAction } from '../components/AccountPresentation';
import { LargeButton } from '../components/LargeButton';
import { Screen, ScreenBackControl } from '../components/Screen';
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
  // The authenticated recording scope owns the thread and its composer. It must
  // not sit inside Screen's full-page ScrollView or the microphone would scroll
  // away with the history. Keep header/actions bounded independently as text grows.
  if (state.status === 'ready' && recordingPanel) return <SafeAreaView style={styles.chatSafeArea}
    edges={['top', 'bottom', 'left', 'right']}>
    <ScreenBackControl language={language} label={backLabel ?? text.back} onPress={onBack} />
    <View style={styles.chatWorkspace}>
      <ScrollView testID="conversation-header-scroll" style={styles.chatHeader}
        contentContainerStyle={styles.chatHeaderContent} keyboardShouldPersistTaps="handled" alwaysBounceVertical={false}>
        <LargeButton label={backLabel ?? text.back} language={language} variant="secondary" density="compact" onPress={onBack} />
        <ApiBackoffBanner />
        <StoryHeading language={language} title={text.title} />
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[state.project.language]}
          allowFontScaling selectable style={styles.chatTitle}>{state.project.title}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>
          {text.language}: {state.session.language === 'sv' ? text.swedish : text.english}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>{text.ready}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>{state.resumed ? text.resumed : text.started}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.metadata}>{text.scope}</Text>
        {onReviewMemories && <LargeButton label={text.review} language={language} variant="secondary" density="compact" onPress={onReviewMemories} />}
        <AccountAction label={text.signOut} language={language} quiet onPress={onSignOut} />
      </ScrollView>
      <View testID="conversation-live-workspace" style={styles.chatBody}>{recordingPanel}</View>
    </View>
  </SafeAreaView>;
  return <Screen back={{ language, label: backLabel ?? text.back, onPress: onBack }}><View style={styles.workspace}>
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
  chatSafeArea: { flex: 1, backgroundColor: colors.cream },
  chatWorkspace: { flex: 1, minHeight: 0, width: '100%', maxWidth: layout.contentWidth, alignSelf: 'center', paddingHorizontal: 16, gap: 8 },
  chatHeader: { flexGrow: 0, flexShrink: 1, maxHeight: '28%', minHeight: layout.minimumTouchTarget },
  chatHeaderContent: { gap: 8, paddingTop: 8, paddingBottom: 8 },
  chatTitle: { color: colors.ink, fontSize: 27, lineHeight: 37, fontFamily: headingFont, flexShrink: 1 },
  chatBody: { flex: 1, minHeight: 0 },
  workspace: { width: '100%', flexGrow: 1, gap: 20 },
  details: { width: '100%', gap: 18 },
  title: { color: colors.ink, fontFamily: headingFont, fontSize: 27, lineHeight: 37, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  metadata: { color: colors.muted, fontSize: 19, lineHeight: 29, flexShrink: 1 },
  sessionDetails: { gap: 6, paddingVertical: 8 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
