import { useEffect } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { AccountAction } from '../components/AccountPresentation';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { StoryDisclosure, StoryHeading } from '../components/StoryPresentation';
import { accessibilityLanguages, type Language } from '../i18n';
import { storyDetailsCopy } from '../story-details-copy';
import { colors } from '../theme';

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
  onReviewMemories?: () => void;
  onGenerate?: () => void;
}

export function StoryDetailsScreen({ language, state, onEdit, onRefresh, onBack, onSignOut, onConversation, onReviewMemories, onGenerate }: Props) {
  const text = storyDetailsCopy[language];
  const { waiting } = useApiBackoff();
  const message = state.status === 'error' ? text.errors[state.error]
    : state.status === 'ready' && state.saved ? text.saved : null;
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  const locale = accessibilityLanguages[language];
  return <Screen><View style={styles.workspace}>
    <StoryHeading language={language} storyLanguage={state.status === 'ready' ? state.project.language : language}
      title={state.status === 'ready' ? state.project.title.trim() || text.untitled : text.title}
      kicker={state.status === 'ready' ? text.title : undefined} />
    <View style={styles.details} accessibilityState={{ busy: state.status === 'loading' }}>
      {state.status === 'loading' && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
        allowFontScaling style={styles.body}>{text.loading}</Text>}
      {state.status === 'error' && <Text accessibilityRole="alert" accessibilityLanguage={locale}
        accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
        allowFontScaling style={styles.notice}>{text.errors[state.error]}</Text>}
      {state.status === 'ready' && <>
        {state.saved && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
          allowFontScaling style={styles.notice}>{text.saved}</Text>}
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.language}>
          {text.language}: {state.project.language === 'sv' ? text.swedish : text.english}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
        {onConversation && <View style={styles.action}>
          <LargeButton label={text.conversation} language={language} density="compact" onPress={onConversation} />
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.shareHelp}</Text>
        </View>}
        {onReviewMemories && <View style={styles.action}>
          <LargeButton label={text.review} language={language} variant="secondary" density="compact" onPress={onReviewMemories} />
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.reviewHelp}</Text>
        </View>}
        {onGenerate && <View style={styles.action}>
          <LargeButton label={text.generate} language={language} variant="secondary" density="compact" onPress={onGenerate} />
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.autobiographyHelp}</Text>
        </View>}
        <StoryDisclosure key={state.project.id} label={text.more} language={language}>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
            {text.status}: {state.project.status === 'draft' ? text.draft : text.otherStatus}
          </Text>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.description}</Text>
          <Text accessibilityLanguage={state.project.description ? accessibilityLanguages[state.project.language] : locale}
            allowFontScaling selectable style={styles.body}>{state.project.description || text.noDescription}</Text>
          <LargeButton label={text.edit} language={language} variant="secondary" density="compact" onPress={onEdit} />
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.metadataHelp}</Text>
          <AccountAction label={text.refresh} language={language} quiet disabled={waiting} onPress={onRefresh} />
        </StoryDisclosure>
      </>}
      {state.status === 'error' && state.error !== 'authentication' &&
        <LargeButton label={text.refresh} language={language} variant="secondary" density="compact" disabled={waiting} onPress={onRefresh} />}
      <LargeButton label={text.back} language={language} variant="secondary" density="compact" onPress={onBack} />
      <AccountAction label={text.signOut} language={language} quiet onPress={onSignOut} />
    </View>
  </View></Screen>;
}

const styles = StyleSheet.create({
  workspace: { width: '100%', flexGrow: 1, gap: 20 },
  details: { width: '100%', gap: 20 }, action: { width: '100%', gap: 8 },
  language: { color: colors.forest, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 31, flexShrink: 1 },
  help: { color: colors.muted, fontSize: 19, lineHeight: 28, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: 16, backgroundColor: colors.paper },
});
