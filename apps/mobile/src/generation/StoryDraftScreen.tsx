import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StoryDraft, StoryProjectVerification } from '../api/story-drafts';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { storyGenerationCopy } from './story-generation-copy';

export interface DraftScreenState {
  phase: 'loading' | 'ready' | 'generating' | 'error' | 'uncertain' | 'checking';
  draft: StoryDraft | null;
  verification: StoryProjectVerification | null;
  error?: StoryProjectsErrorKind;
  code?: string;
  notice?: 'saved' | 'loaded' | 'uncertain';
  canRetry: boolean;
}
export interface StoryDraftScreenProps {
  language: Language;
  storyLanguage: Language;
  title: string;
  state: DraftScreenState;
  onGenerate: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onReviewMemories: () => void;
  onBack: () => void;
  onSignOut: () => void;
  onEdit?: () => void;
  onHistory?: () => void;
}

function DraftButton({ language, label, onPress, disabled = false, primary = false, expanded }: {
  language: Language; label: string; onPress: () => void; disabled?: boolean; primary?: boolean; expanded?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary,
      disabled && styles.disabled, primary && disabled && styles.disabledPrimary, focused && styles.focused, pressed && !disabled && styles.pressed]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

/** Presentation only. The controller owns authentication, saved data and action UUIDs. */
export function StoryDraftScreen(props: StoryDraftScreenProps) {
  const key = JSON.stringify([props.state.phase, props.storyLanguage, props.title,
    props.state.draft?.draft_id, props.state.draft?.revision]);
  return <StoryDraftView key={key} {...props} />;
}
function StoryDraftView({ language, storyLanguage, title, state, onGenerate, onRetry, onRefresh,
  onReviewMemories, onBack, onSignOut, onEdit, onHistory }: StoryDraftScreenProps) {
  const text = storyGenerationCopy[language];
  const locale = accessibilityLanguages[language];
  const [confirming, setConfirming] = useState(false);
  const submitted = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const panelY = useRef(0);
  const contentY = useRef(0);
  const busy = state.phase === 'loading' || state.phase === 'generating' || state.phase === 'checking';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const draft = accessFailed || state.phase === 'loading' ? null : state.draft;
  const codeMessage = state.code && Object.hasOwn(text.codes, state.code)
    ? text.codes[state.code as keyof typeof text.codes] : undefined;
  const message = state.error ? codeMessage ?? text.errors[state.error]
    : state.phase === 'error' ? codeMessage ?? text.errors.unavailable
      : state.phase === 'loading' ? text.loading : state.phase === 'generating' ? text.generating
        : state.phase === 'checking' ? text.checking : state.phase === 'uncertain' ? text.uncertain
          : state.notice && (state.notice === 'uncertain' || draft) ? text[state.notice] : null;
  const canGenerate = state.phase === 'ready' && !state.error && !accessFailed && !state.canRetry;
  const canRetry = state.canRetry && !busy && !accessFailed && (state.phase === 'uncertain' || state.phase === 'error');
  const needsMemoryReview = ['NO_CONFIRMED_MEMORIES', 'NO_SUPPORTED_MEMORIES', 'CLARIFICATION_REQUIRED',
    'STORY_CONTEXT_CHANGED'].includes(state.code ?? '');
  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    if (state.error || state.phase === 'uncertain') {
      scroll.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current - 16), animated: false });
    }
  }, [message, state.error, state.phase]);

  const prepare = () => {
    if (!canGenerate || submitted.current) return;
    setConfirming(true);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.confirmTitle);
  };
  const confirm = () => {
    if (!confirming || !canGenerate || submitted.current) return;
    submitted.current = true; setConfirming(false); onGenerate();
  };
  const refresh = () => {
    if (busy || accessFailed) return;
    setConfirming(false); submitted.current = false; onRefresh();
  };
  const retry = () => {
    if (!canRetry || submitted.current) return;
    submitted.current = true; onRetry();
  };
  return <Screen scrollViewRef={scroll} onContentLayout={event => { contentY.current = event.nativeEvent.layout.y; }}>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.title}</Text>
    {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[storyLanguage]}
      allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
    <View style={styles.panel} accessibilityState={{ busy }} onLayout={event => { panelY.current = event.nativeEvent.layout.y; }}>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
      {!accessFailed && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
        {text.language}: {storyLanguage === 'sv' ? text.swedish : text.english}
      </Text>}
      {message && <Text accessibilityRole={state.error || state.phase === 'uncertain' || state.phase === 'error' ? 'alert' : undefined}
        accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.notice}>{message}</Text>}
      {state.error && state.phase === 'uncertain' && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
      {state.phase === 'ready' && !draft && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noDraft}</Text>}
      {draft && <SavedDraft key={draft.draft_id + ':' + draft.revision} language={language} draft={draft} report={state.verification} />}
      {draft && canGenerate && !confirming && <>
        {onEdit && <DraftButton language={language} label={text.edit} onPress={onEdit} />}
        {onHistory && <DraftButton language={language} label={text.history} onPress={onHistory} />}
      </>}
      {confirming && canGenerate ? <View style={styles.confirmation}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.confirmTitle}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.confirmation}</Text>
        <DraftButton language={language} label={text.confirm} primary onPress={confirm} />
        <DraftButton language={language} label={text.cancel} onPress={() => { setConfirming(false); }} />
      </View> : <>
        {canGenerate && <DraftButton language={language} label={draft ? text.generateAgain : text.generate} primary onPress={prepare} />}
        {canRetry && <>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.retryHelp}</Text>
          <DraftButton language={language} label={text.retry} primary onPress={retry} />
        </>}
      </>}
      <DraftButton language={language} label={text.refresh} primary={state.phase === 'uncertain' && !canRetry}
        disabled={busy || accessFailed} onPress={refresh} />
      <DraftButton language={language} label={text.review} primary={needsMemoryReview && state.phase === 'error' && !canRetry && !accessFailed}
        disabled={busy || accessFailed} onPress={() => { setConfirming(false); onReviewMemories(); }} />
      <DraftButton language={language} label={text.back} onPress={onBack} />
      <DraftButton language={language} label={text.signOut} onPress={onSignOut} />
    </View>
  </Screen>;
}

function SavedDraft({ language, draft, report }: { language: Language; draft: StoryDraft; report: StoryProjectVerification | null }) {
  const text = storyGenerationCopy[language];
  const locale = accessibilityLanguages[language];
  const sourceLocale = accessibilityLanguages[draft.language];
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const matched = !report || (report.draft_id === draft.draft_id && report.project_id === draft.project_id &&
    report.version === draft.version && report.revision === draft.revision);
  const verification = matched ? report?.verification ?? draft.verification : null;
  const safeReport = verification && !(verification.status === 'passed' && verification.unsupported_claims.length);
  const index = Math.min(sourceIndex, Math.max(0, draft.source_memories.length - 1));
  const source = draft.source_memories[index];
  return <View style={styles.panel}>
    <Text accessibilityLanguage={sourceLocale} allowFontScaling selectable style={styles.draftText}>{draft.content}</Text>
    <View style={styles.card}>
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.verification}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
        {safeReport && verification ? text.statuses[verification.status] : text.verificationUnavailable}
      </Text>
      {verification?.sources_current === false && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.sourcesChanged}</Text>}
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.verificationHelp}</Text>
    </View>
    <DraftButton language={language} label={sourcesOpen ? text.hideSources : text.showSources} expanded={sourcesOpen}
      onPress={() => setSourcesOpen(open => !open)} />
    {sourcesOpen && <View style={styles.card}>
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.sourceTitle}</Text>
      {!source ? <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noSources}</Text> : <>
        <Text accessibilityRole="header" accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.subheading}>
          {text.source} {index + 1} {text.of} {draft.source_memories.length}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.sentence}</Text>
        <Text accessibilityLanguage={sourceLocale} allowFontScaling selectable style={styles.body}>{source.sentence}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.original}</Text>
        <Text accessibilityLanguage={sourceLocale} allowFontScaling selectable style={styles.body}>{source.value}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.evidence}</Text>
        <Text accessibilityLanguage={sourceLocale} allowFontScaling selectable style={styles.body}>{source.evidence}</Text>
        {source.corrected_value !== null && <>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.correction}</Text>
          <Text accessibilityLanguage={sourceLocale} allowFontScaling selectable style={styles.body}>{source.corrected_value}</Text>
        </>}
        {source.year !== null && <>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.year}: {source.year}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.yearHelp}</Text>
        </>}
        <DraftButton language={language} label={text.previous} disabled={index === 0} onPress={() => setSourceIndex(Math.max(0, index - 1))} />
        <DraftButton language={language} label={text.next} disabled={index + 1 >= draft.source_memories.length}
          onPress={() => setSourceIndex(Math.min(draft.source_memories.length - 1, index + 1))} />
      </>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: 24 }, card: { width: '100%', gap: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  confirmation: { width: '100%', gap: 20, padding: 16, borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  draftText: { color: colors.ink, fontFamily: headingFont, fontSize: 24, lineHeight: 38, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest }, secondary: { backgroundColor: colors.paper, borderColor: colors.forest },
  disabled: { borderColor: colors.muted }, disabledPrimary: { backgroundColor: colors.muted }, focused: { borderColor: colors.ink },
  pressed: { borderColor: colors.ink }, buttonText: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryText: { color: colors.paper },
});
