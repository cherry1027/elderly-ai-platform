import { useEffect, useState, type PropsWithChildren } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../api/story-projects';
import { AccountAction } from '../components/AccountPresentation';
import { LargeButton } from '../components/LargeButton';
import { Screen } from '../components/Screen';
import { StoryHeading } from '../components/StoryPresentation';
import { accessibilityLanguages, type Language } from '../i18n';
import { storyDetailsCopy } from '../story-details-copy';
import { colors, layout } from '../theme';

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

/** Visibility only: rare actions keep their original owning callbacks. */
function StoryOptions({ language, children }: PropsWithChildren<{ language: Language }>) {
  const [expanded, setExpanded] = useState(false), [focused, setFocused] = useState(false);
  return <View style={styles.options}>
    <Pressable accessibilityRole="button" accessibilityLabel={storyDetailsCopy[language].more}
      accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.more, pressed && styles.pressed, focused && styles.focused]}>
      <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        allowFontScaling style={styles.moreLabel}>⋯</Text>
    </Pressable>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      style={[styles.optionContents, !expanded && styles.hidden]}>{children}</View>
  </View>;
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
  return <Screen back={{ language, label: text.back, onPress: onBack }}><View style={styles.workspace}>
    <StoryHeading language={language} storyLanguage={state.status === 'ready' ? state.project.language : language}
      title={state.status === 'ready' ? state.project.title.trim() || text.untitled : text.title} />
    <View style={styles.details} accessibilityState={{ busy: state.status === 'loading' }}>
      {state.status === 'loading' && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
        allowFontScaling style={styles.body}>{text.loading}</Text>}
      {state.status === 'error' && <Text accessibilityRole="alert" accessibilityLanguage={locale}
        accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
        allowFontScaling style={styles.notice}>{text.errors[state.error]}</Text>}
      {state.status === 'ready' && <>
        {state.saved && <Text accessibilityLiveRegion="polite" accessibilityLanguage={locale}
          allowFontScaling style={styles.notice}>{text.saved}</Text>}
        {onConversation && <View style={styles.primaryAction}>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.introduction}</Text>
          <LargeButton label={text.conversation} language={language} density="compact" onPress={onConversation} />
        </View>}
        <View style={styles.destinations}>
          {onReviewMemories && <LargeButton label={text.review} language={language} variant="tertiary" density="compact" onPress={onReviewMemories} />}
          {onGenerate && <LargeButton label={text.generate} language={language} variant="tertiary" density="compact" onPress={onGenerate} />}
        </View>
        <StoryOptions key={state.project.id} language={language}>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.language}>
            {text.language}: {state.project.language === 'sv' ? text.swedish : text.english}
          </Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
            {text.status}: {state.project.status === 'draft' ? text.draft : text.otherStatus}
          </Text>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.description}</Text>
          <Text accessibilityLanguage={state.project.description ? accessibilityLanguages[state.project.language] : locale}
            allowFontScaling selectable style={styles.body}>{state.project.description || text.noDescription}</Text>
          <LargeButton label={text.edit} language={language} variant="secondary" density="compact" onPress={onEdit} />
          <AccountAction label={text.refresh} language={language} quiet disabled={waiting} onPress={onRefresh} />
          <AccountAction label={text.signOut} language={language} quiet onPress={onSignOut} />
        </StoryOptions>
      </>}
      {state.status === 'error' && state.error !== 'authentication' &&
        <AccountAction label={text.refresh} language={language} quiet disabled={waiting} onPress={onRefresh} />}
      <LargeButton label={text.back} language={language} variant="tertiary" density="compact" onPress={onBack} />
      {state.status !== 'ready' && <AccountAction label={text.signOut} language={language} quiet onPress={onSignOut} />}
    </View>
  </View></Screen>;
}

const styles = StyleSheet.create({
  workspace: { width: '100%', flexGrow: 1, gap: 28 },
  details: { width: '100%', gap: 20 }, primaryAction: { width: '100%', gap: 12 },
  destinations: { width: '100%', gap: 4 },
  options: { width: '100%', gap: 12 }, optionContents: { width: '100%', gap: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  more: { alignSelf: 'flex-end', minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', borderRadius: 12, paddingHorizontal: 12 },
  moreLabel: { color: colors.forest, fontSize: 30, lineHeight: 40 },
  hidden: { display: 'none' }, pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink },
  language: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 31, flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  notice: { color: colors.ink, fontSize: 21, lineHeight: 31, paddingVertical: 12, paddingHorizontal: 16,
    borderLeftWidth: 3, borderLeftColor: colors.forest, backgroundColor: colors.selected },
});
