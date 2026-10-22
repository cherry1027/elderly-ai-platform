import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View } from 'react-native';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../api/audio-transcripts';
import type { ConversationMessage } from '../api/conversation-messages';
import { validateMemoryPatchInput, type MemoryFact, type MemoryClarification, type MemoryPatchInput } from '../api/memory-review';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { memoryReviewCopy } from './memory-review-copy';

export interface MemoryReviewState {
  phase: 'loading' | 'ready' | 'saving' | 'error' | 'conflict' | 'uncertain';
  memories: MemoryFact[];
  clarifications: MemoryClarification[];
  sources: ConversationMessage[];
  complete: boolean;
  error?: StoryProjectsErrorKind;
  notice?: 'saved' | 'conflict' | 'uncertain';
}
export interface MemoryReviewScreenProps {
  language: Language;
  storyLanguage?: Language;
  resetRevision?: number;
  title: string;
  state: MemoryReviewState;
  onSave: (memory: MemoryFact, status: 'confirmed' | 'rejected', correction?: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  backLabel?: string;
  onSignOut: () => void;
}

function ReviewButton({ language, label, onPress, disabled = false, primary = false, checked, expanded }: {
  language: Language; label: string; onPress: () => void; disabled?: boolean;
  primary?: boolean; checked?: boolean; expanded?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole={checked === undefined ? 'button' : 'radio'}
    accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }),
      ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary,
      checked && styles.selected, disabled && styles.disabled, disabled && primary && styles.disabledPrimary, focused && styles.focused,
      pressed && !disabled && styles.pressed]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.primaryText]}>{checked ? '✓ ' : ''}{label}</Text>
  </Pressable>;
}

/** A calm read-only view until the person explicitly chooses and saves a review. */
export function MemoryReviewScreen({ language, storyLanguage = language, resetRevision = 0, title, state, onSave, onRefresh, onBack, onSignOut, backLabel }: MemoryReviewScreenProps) {
  const text = memoryReviewCopy[language];
  const locale = accessibilityLanguages[language];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollView = useRef<ScrollView>(null);
  const contentY = useRef(0);
  const panelY = useRef(0);
  const busy = state.phase === 'loading' || state.phase === 'saving';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const index = Math.min(selectedIndex, Math.max(0, state.memories.length - 1));
  const memory = !accessFailed && state.phase !== 'loading' ? state.memories[index] : undefined;
  const message = state.error ? text.errors[state.error]
    : state.phase === 'error' ? text.errors.unavailable : state.phase === 'loading' ? text.loading : state.phase === 'saving' ? text.saving
      : state.phase === 'conflict' || state.phase === 'uncertain' ? text[state.phase]
        : state.notice ? text[state.notice] : null;
  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    if (state.error || state.phase === 'conflict' || state.phase === 'uncertain') {
      Keyboard.dismiss();
      scrollView.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current - 16), animated: false });
    }
  }, [message, state.error, state.phase]);

  const navigate = (next: number) => {
    if (busy) return;
    Keyboard.dismiss(); setSelectedIndex(next);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.memory + ' ' + (next + 1) + ' ' + text.of + ' ' + state.memories.length);
    scrollView.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current - 16), animated: false });
  };
  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen scrollViewRef={scrollView} onContentLayout={event => { contentY.current = event.nativeEvent.layout.y; }}>
      <MemyBrand />
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.title}</Text>
      {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
      <View style={styles.panel} accessibilityState={{ busy }} onLayout={event => { panelY.current = event.nativeEvent.layout.y; }}>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
        {message && <Text accessibilityRole={state.error || state.phase === 'conflict' || state.phase === 'uncertain' ? 'alert' : undefined}
          accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.notice}>{message}</Text>}
        {state.error && (state.phase === 'conflict' || state.phase === 'uncertain') && <Text accessibilityLanguage={locale}
          allowFontScaling style={styles.notice}>{text[state.phase]}</Text>}
        {state.phase === 'ready' && !state.complete && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.incomplete}</Text>}
        {state.phase === 'ready' && state.complete && !memory && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.empty}</Text>}
        {memory && <>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>
            {text.memory} {index + 1} {text.of} {state.memories.length}
          </Text>
          <MemoryCard key={`${memory.id}:${memory.version}:${resetRevision}`} language={language} memory={memory} state={state}
            onSave={onSave} scrollView={scrollView} contentY={contentY} panelY={panelY} />
          <ReviewButton language={language} label={text.previous} disabled={busy || index === 0} onPress={() => navigate(index - 1)} />
          <ReviewButton language={language} label={text.next} disabled={busy || index + 1 >= state.memories.length} onPress={() => navigate(index + 1)} />
        </>}
        <ReviewButton language={language} label={text.refresh} disabled={busy || accessFailed} onPress={() => { Keyboard.dismiss(); onRefresh(); }} />
        <ReviewButton language={language} label={backLabel ?? text.back} onPress={() => { Keyboard.dismiss(); onBack(); }} />
        <ReviewButton language={language} label={text.signOut} onPress={() => { Keyboard.dismiss(); onSignOut(); }} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}

function MemoryCard({ language, memory, state, onSave, scrollView, contentY, panelY }: {
  language: Language; memory: MemoryFact; state: MemoryReviewState; onSave: MemoryReviewScreenProps['onSave'];
  scrollView: RefObject<ScrollView | null>; contentY: RefObject<number>; panelY: RefObject<number>;
}) {
  const text = memoryReviewCopy[language];
  const locale = accessibilityLanguages[language];
  const currentValue = memory.corrected_value ?? memory.value;
  const [action, setAction] = useState<'confirm' | 'correct' | 'reject' | null>(null);
  const [draft, setDraft] = useState('');
  const [validation, setValidation] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const submitted = useRef(false);
  const cardY = useRef(0);
  const correctionY = useRef(0);
  const source = state.sources.find(row => row.id === memory.source_message_id && row.role === 'user' &&
    row.session_id === memory.session_id && row.text.includes(memory.evidence) && row.text.includes(memory.value));
  const simulated = source?.text.startsWith(SIMULATED_TRANSCRIPT_NOTICE) === true;
  const canReview = state.phase === 'ready' && state.complete && !!source;
  const questions = state.clarifications.filter(question => question.fact_id === memory.id &&
    question.session_id === memory.session_id && question.status === 'open');
  useEffect(() => { submitted.current = false; }, [state.phase, state.error, state.notice]);
  const revealError = useCallback(() => {
    if (!validation) return;
    scrollView.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current + cardY.current + correctionY.current - 16), animated: false });
  }, [validation, scrollView, contentY, panelY]);
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', revealError);
    const shown = Keyboard.addListener('keyboardDidShow', revealError);
    return () => { hidden.remove(); shown.remove(); };
  }, [revealError]);
  useEffect(() => {
    if (!validation) return;
    revealError();
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.correctionError);
  }, [validation, attempt, revealError, text.correctionError]);
  const choose = (next: 'confirm' | 'correct' | 'reject') => {
    if (!canReview || submitted.current) return;
    Keyboard.dismiss(); setAction(next); setValidation(false); setDraft(next === 'correct' ? currentValue : '');
  };
  const save = () => {
    if (!canReview || !action || submitted.current) return;
    let input: MemoryPatchInput;
    try {
      input = validateMemoryPatchInput({ status: action === 'reject' ? 'rejected' : 'confirmed', expected_version: memory.version,
        ...(action === 'correct' ? { corrected_value: draft } : {}) });
    } catch {
      setValidation(true); setAttempt(value => value + 1); Keyboard.dismiss(); return;
    }
    const correction = action === 'correct' && draft !== currentValue && input.corrected_value !== currentValue ? input.corrected_value : undefined;
    submitted.current = true; setValidation(false); Keyboard.dismiss();
    if (correction === undefined) onSave(memory, input.status);
    else onSave(memory, input.status, correction);
  };
  return <View style={styles.card} onLayout={event => { cardY.current = event.nativeEvent.layout.y; revealError(); }}>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.types[memory.fact_type]}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.current}</Text>
    <Text accessibilityLanguage={source ? accessibilityLanguages[source.language] : locale} allowFontScaling selectable style={styles.value}>{currentValue}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.status}: {text.statuses[memory.status]}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.original}</Text>
    <Text accessibilityLanguage={source ? accessibilityLanguages[source.language] : locale} allowFontScaling selectable style={styles.body}>{memory.value}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.evidence}</Text>
    <Text accessibilityLanguage={source ? accessibilityLanguages[source.language] : locale} allowFontScaling selectable style={styles.body}>{memory.evidence}</Text>
    {memory.year !== null && <>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.originalYear}: {memory.year}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.yearHelp}</Text>
    </>}
    {memory.uncertain && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertainFact}</Text>}
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{!source ? text.sourceMissing : simulated ? text.simulated : text.unclassified}</Text>
    {source && <>
      <ReviewButton language={language} label={sourceOpen ? text.hideSource : text.showSource} expanded={sourceOpen} onPress={() => setSourceOpen(open => !open)} />
      {sourceOpen && <View style={styles.field}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.sourceTitle}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[source.language]} allowFontScaling selectable style={styles.body}>{source.text}</Text>
      </View>}
    </>}
    {!!questions.length && <View style={styles.field}>
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.questions}</Text>
      {questions.slice(0, 3).map(question => <Text key={question.id} accessibilityLanguage={source ? accessibilityLanguages[source.language] : locale} allowFontScaling style={styles.body}>{question.question}</Text>)}
      {questions.length > 3 && <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.questionsCount}: 3 {text.of} {questions.length}</Text>}
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.questionHelp}</Text>
    </View>}
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.choose}</Text>
    {(['confirm', 'correct', 'reject'] as const).map(next => <ReviewButton key={next} language={language} label={text[next]}
      checked={action === next} disabled={!canReview} onPress={() => choose(next)} />)}
    {action === 'correct' && <View style={styles.field} onLayout={event => { correctionY.current = event.nativeEvent.layout.y; revealError(); }}>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.correctionLabel}</Text>
      {validation && <Text accessibilityRole="alert" accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.notice}>{text.correctionError}</Text>}
      <TextInput value={draft} onChangeText={value => { setDraft(value); setValidation(false); }}
        accessibilityLabel={text.correctionLabel} accessibilityLanguage={locale}
        accessibilityHint={validation ? `${text.correctionError} ${text.correctionHelp}` : text.correctionHelp}
        allowFontScaling editable={canReview} multiline textAlignVertical="top" autoCapitalize="sentences" autoCorrect
        returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.input, focused && styles.focused]} />
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.correctionHelp}</Text>
      <ReviewButton language={language} label={text.done} disabled={!canReview} onPress={() => Keyboard.dismiss()} />
      <ReviewButton language={language} label={text.cancelCorrection} disabled={!canReview} onPress={() => {
        Keyboard.dismiss(); setAction(null); setDraft(''); setValidation(false);
      }} />
    </View>}
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.notSaved}</Text>
    <ReviewButton language={language} label={state.phase === 'saving' ? text.saving : text.save}
      primary disabled={!canReview || !action} onPress={save} />
  </View>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 }, panel: { width: '100%', gap: 24 }, card: { width: '100%', gap: 20 }, field: { width: '100%', gap: 16 },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  value: { color: colors.ink, fontSize: 28, lineHeight: 38, fontWeight: '600', flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest },
  secondary: { backgroundColor: colors.paper, borderColor: colors.forest },
  selected: { backgroundColor: colors.selected, borderWidth: 3 },
  disabled: { borderColor: colors.muted }, disabledPrimary: { backgroundColor: colors.muted }, focused: { borderColor: colors.ink }, pressed: { borderColor: colors.ink },
  buttonText: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryText: { color: colors.paper },
  input: { minHeight: 112, width: '100%', borderWidth: 2, borderColor: colors.border, borderRadius: layout.controlRadius,
    padding: 16, backgroundColor: colors.paper, color: colors.ink, fontSize: 22, lineHeight: 32 },
});
