import { useCallback, useEffect, useRef, useState, type ComponentRef, type Ref, type RefObject } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View } from 'react-native';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../api/audio-transcripts';
import { useApiBackoff } from '../api/ApiBackoff';
import type { ConversationMessage } from '../api/conversation-messages';
import { validateMemoryPatchInput, type MemoryFact, type MemoryClarification, type MemoryPatchInput } from '../api/memory-review';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { Screen } from '../components/Screen';
import { StoryHeading } from '../components/StoryPresentation';
import { useGuardedLeave, type LeaveHandle } from '../navigation/useGuardedLeave';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { memoryReviewCopy } from './memory-review-copy';

export interface MemoryReviewDraft {
  memoryId: string;
  expectedVersion: number;
  action: 'confirm' | 'correct' | 'reject';
  correction: string;
}
export interface MemoryReviewState {
  phase: 'loading' | 'ready' | 'saving' | 'error' | 'conflict' | 'uncertain';
  memories: MemoryFact[];
  clarifications: MemoryClarification[];
  sources: ConversationMessage[];
  complete: boolean;
  error?: StoryProjectsErrorKind;
  notice?: 'saved' | 'conflict' | 'uncertain' | 'retained';
  retainedReview?: MemoryReviewDraft & { memory: MemoryFact; canRetry: boolean; conflict: boolean };
}
export interface MemoryReviewScreenProps {
  language: Language;
  storyLanguage?: Language;
  resetRevision?: number;
  title: string;
  state: MemoryReviewState;
  onSave: (memory: MemoryFact, status: 'confirmed' | 'rejected', correction?: string) => void;
  onCaptureReview?: (draft: MemoryReviewDraft) => void;
  onReviewLatest?: () => void;
  onRefresh: () => void;
  onBack: () => void;
  backLabel?: string;
  onSignOut: () => void;
  leaveRef?: Ref<LeaveHandle>;
}

function ReviewButton({ language, label, onPress, disabled = false, primary = false, quiet = false, checked, expanded }: {
  language: Language; label: string; onPress: () => void; disabled?: boolean;
  primary?: boolean; quiet?: boolean; checked?: boolean; expanded?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole={checked === undefined ? 'button' : 'radio'}
    accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, ...(checked === undefined ? {} : { checked }),
      ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary,
      quiet && styles.quiet, checked && styles.selected, disabled && styles.disabled, disabled && primary && styles.disabledPrimary, focused && styles.focused,
      pressed && !disabled && styles.pressed]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.primaryText, quiet && styles.quietText]}>{checked ? '✓ ' : ''}{label}</Text>
  </Pressable>;
}

/** A calm read-only view until the person explicitly chooses and saves a review. */
export function MemoryReviewScreen({ language, storyLanguage = language, resetRevision = 0, title, state, onSave, onCaptureReview,
  onReviewLatest, onRefresh, onBack, onSignOut, backLabel, leaveRef }: MemoryReviewScreenProps) {
  const text = memoryReviewCopy[language];
  const { waiting } = useApiBackoff();
  const locale = accessibilityLanguages[language];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discardRevision, setDiscardRevision] = useState(0);
  const captureDirty = useCallback((value: boolean) => setDirty(value), []);
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentY = useRef(0);
  const panelY = useRef(0);
  const busy = state.phase === 'loading' || state.phase === 'saving';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const retained = state.retainedReview;
  const { requestLeave, dialog } = useGuardedLeave({ language, dirty: dirty || !!retained, handleRef: leaveRef,
    uncertain: state.phase === 'saving' || state.phase === 'uncertain' || state.notice === 'uncertain',
    onDiscard: () => { setDirty(false); setDiscardRevision(value => value + 1); },
    onCheckSavedResult: onRefresh, checkDisabled: waiting || busy || accessFailed });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { requestLeave(onBack); return true; });
    return () => subscription.remove();
  }, [requestLeave, onBack]);
  const index = Math.max(0, state.memories.findIndex(item => item.id === (retained?.memoryId ?? selectedId)));
  // A failed/partial reconciliation must not unmount the retained correction.
  const memory = !accessFailed ? retained?.memory ?? (state.phase !== 'loading' ? state.memories[index] : undefined) : undefined;
  const currentMemory = retained ? state.memories.find(item => item.id === retained.memoryId) : undefined;
  const freshReview = state.phase === 'ready' && !state.error && state.complete;
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
    if (busy || retained || !state.memories[next]) return;
    requestLeave(() => {
      Keyboard.dismiss(); setSelectedId(state.memories[next].id);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.memory + ' ' + (next + 1) + ' ' + text.of + ' ' + state.memories.length);
      scrollView.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current - 16), animated: false });
    });
  };
  return <><KeyboardAvoidingView style={styles.keyboard} enabled={Platform.OS !== 'ios'} behavior="height">
    <Screen keyboardAware scrollViewRef={scrollView} onContentLayout={event => { contentY.current = event.nativeEvent.layout.y; }}>
      <View style={styles.composition}>
      <StoryHeading language={language} title={text.title} />
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
            {state.memories.length ? `${text.memory} ${index + 1} ${text.of} ${state.memories.length}` : text.memory}
          </Text>
          <MemoryCard key={`${memory.id}:${memory.version}:${resetRevision}:${discardRevision}`} language={language} memory={memory} state={state}
            onCaptureReview={draft => { setSelectedId(draft.memoryId); onCaptureReview?.(draft); }}
            onDirtyChange={captureDirty} onSave={onSave} scrollView={scrollView} contentY={contentY} panelY={panelY} />
          {retained?.conflict && <>
            {freshReview && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.retainedConflict}</Text>}
            {freshReview && currentMemory && <>
              <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.latestValue}</Text>
              <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.value}>
                {currentMemory.corrected_value ?? currentMemory.value}
              </Text>
            </>}
            {freshReview && !currentMemory && <Text accessibilityLanguage={locale} allowFontScaling
              style={styles.notice}>{text.missingReviewMemory}</Text>}
            {onReviewLatest && <ReviewButton language={language} label={text.reviewLatest}
              disabled={busy || !freshReview || !currentMemory} onPress={onReviewLatest} />}
          </>}
          <View style={styles.paging}>
            <View style={styles.pageAction}><ReviewButton language={language} label={text.previous} disabled={busy || !!retained || index === 0} onPress={() => navigate(index - 1)} /></View>
            <View style={styles.pageAction}><ReviewButton language={language} label={text.next} disabled={busy || !!retained || index + 1 >= state.memories.length} onPress={() => navigate(index + 1)} /></View>
          </View>
        </>}
        <ReviewButton language={language} label={text.refresh} quiet disabled={waiting || busy || accessFailed} onPress={() => {
          Keyboard.dismiss();
          // A retained review belongs to the controller's read-only reconciliation.
          // Refresh must never discard its captured correction or expected version.
          if (retained) onRefresh(); else requestLeave(onRefresh);
        }} />
        <ReviewButton language={language} label={backLabel ?? text.back} quiet onPress={() => requestLeave(onBack)} />
        <ReviewButton language={language} label={text.signOut} quiet onPress={() => requestLeave(onSignOut)} />
      </View>
      </View>
    </Screen>
  </KeyboardAvoidingView>{dialog}</>;
}

function MemoryCard({ language, memory, state, onSave, onCaptureReview, onDirtyChange, scrollView, contentY, panelY }: {
  language: Language; memory: MemoryFact; state: MemoryReviewState; onSave: MemoryReviewScreenProps['onSave'];
  onCaptureReview?: MemoryReviewScreenProps['onCaptureReview'];
  onDirtyChange: (dirty: boolean) => void;
  scrollView: RefObject<ComponentRef<typeof ScrollView> | null>; contentY: RefObject<number>; panelY: RefObject<number>;
}) {
  const text = memoryReviewCopy[language];
  const { waiting } = useApiBackoff();
  const locale = accessibilityLanguages[language];
  const retained = state.retainedReview;
  const currentValue = memory.corrected_value ?? memory.value;
  const [action, setAction] = useState<'confirm' | 'correct' | 'reject' | null>(() => retained?.action ?? null);
  const [draft, setDraft] = useState(() => retained?.correction ?? '');
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
  const canReview = !retained && state.phase === 'ready' && state.complete && !!source;
  const canSave = canReview || (!!retained?.canRetry && !retained.conflict && state.phase === 'ready' && state.complete && !!source);
  const questions = state.clarifications.filter(question => question.fact_id === memory.id &&
    question.session_id === memory.session_id && question.status === 'open');
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { submitted.current = false; }, [state.phase, state.error, state.notice]);
  const revealError = useCallback(() => {
    if (!validation || Keyboard.isVisible()) return;
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
    Keyboard.dismiss(); setAction(next); setValidation(false); setDraft(next === 'correct' ? currentValue : ''); onDirtyChange(true);
  };
  const save = () => {
    if (waiting || !canSave || !action || submitted.current) return;
    let input: MemoryPatchInput;
    try {
      input = validateMemoryPatchInput({ status: action === 'reject' ? 'rejected' : 'confirmed', expected_version: memory.version,
        ...(action === 'correct' ? { corrected_value: draft } : {}) });
    } catch {
      setValidation(true); setAttempt(value => value + 1); Keyboard.dismiss(); return;
    }
    const correction = action === 'correct' && draft !== currentValue && input.corrected_value !== currentValue ? input.corrected_value : undefined;
    submitted.current = true; setValidation(false); Keyboard.dismiss();
    onCaptureReview?.({ memoryId: memory.id, expectedVersion: memory.version, action, correction: draft });
    if (correction === undefined) onSave(memory, input.status);
    else onSave(memory, input.status, correction);
  };
  return <View style={styles.card} onLayout={event => { cardY.current = event.nativeEvent.layout.y; revealError(); }}>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>{text.types[memory.fact_type]}</Text>
    <View style={styles.reviewValue}>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.current}</Text>
    <Text accessibilityLanguage={source ? accessibilityLanguages[source.language] : locale} allowFontScaling selectable style={styles.value}>{currentValue}</Text>
    <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.status}: {text.statuses[memory.status]}</Text>
    </View>
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
      <TextInput value={draft} onChangeText={value => { if (canReview) { setDraft(value); setValidation(false); } }}
        accessibilityLabel={text.correctionLabel} accessibilityLanguage={locale}
        accessibilityHint={validation ? `${text.correctionError} ${text.correctionHelp}` : text.correctionHelp}
        allowFontScaling editable={canReview} multiline textAlignVertical="top" autoCapitalize="sentences" autoCorrect
        returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.input, focused && styles.focused]} />
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.correctionHelp}</Text>
      <ReviewButton language={language} label={text.done} disabled={!canReview} onPress={() => Keyboard.dismiss()} />
      <ReviewButton language={language} label={text.cancelCorrection} disabled={!canReview} onPress={() => {
        Keyboard.dismiss(); setAction(null); setDraft(''); setValidation(false); onDirtyChange(false);
      }} />
    </View>}
    {!retained && <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.notSaved}</Text>}
    {retained && (state.error || state.notice !== 'retained' || state.phase !== 'ready') &&
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.retained}</Text>}
    <ReviewButton language={language} label={state.phase === 'saving' ? text.saving : text.save}
      primary disabled={waiting || !canSave || !action} onPress={save} />
  </View>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 }, composition: { width: '100%', gap: 16 }, panel: { width: '100%', gap: 16 },
  card: { width: '100%', gap: 16, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.paper },
  field: { width: '100%', gap: 12 }, reviewValue: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.selected },
  paging: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, pageAction: { flexBasis: 180, flexGrow: 1 },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  value: { color: colors.ink, fontSize: 28, lineHeight: 38, fontWeight: '600', flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 2, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest },
  secondary: { backgroundColor: colors.paper, borderColor: colors.border },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' }, quietText: { textDecorationLine: 'underline' },
  selected: { backgroundColor: colors.selected, borderWidth: 3 },
  disabled: { borderColor: colors.muted }, disabledPrimary: { backgroundColor: colors.muted }, focused: { borderColor: colors.ink }, pressed: { borderColor: colors.ink },
  buttonText: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryText: { color: colors.paper },
  input: { minHeight: 112, width: '100%', borderWidth: 2, borderColor: colors.border, borderRadius: layout.controlRadius,
    padding: 16, backgroundColor: colors.paper, color: colors.ink, fontSize: 22, lineHeight: 32 },
});
