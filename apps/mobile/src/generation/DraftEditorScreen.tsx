import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View } from 'react-native';
import type { StoryDraft } from '../api/story-drafts';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { draftEditingCopy } from './draft-editing-copy';

export interface DraftEditingState {
  phase: 'loading' | 'editing' | 'saving' | 'uncertain' | 'conflict' | 'error' | 'saved';
  draft: StoryDraft | null;
  text: string;
  error?: StoryProjectsErrorKind;
  validation?: 'required' | 'too-long' | 'invalid';
  canRetry: boolean;
  compare?: StoryDraft;
  dirty: boolean;
}
export interface DraftEditorScreenProps {
  language: Language; storyLanguage: Language; title: string; state: DraftEditingState;
  onChangeText: (value: string) => void; onSave: () => void; onCheck: () => void; onRetry: () => void;
  onUseLatest: () => void; onKeepMine: () => void; onBack: () => void; onSignOut: () => void;
}
export function DraftEditingButton({ language, label, onPress, disabled = false, primary = false, expanded }: {
  language: Language; label: string; onPress: () => void; disabled?: boolean; primary?: boolean; expanded?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, disabled && styles.disabled,
      primary && disabled && styles.disabledPrimary, focused && styles.focused, pressed && !disabled && styles.pressed]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

/** Controlled in-memory wording only. Done, blur and navigation never save. */
export function DraftEditorScreen({ language, storyLanguage, title, state, onChangeText, onSave, onCheck,
  onRetry, onUseLatest, onKeepMine, onBack, onSignOut }: DraftEditorScreenProps) {
  const text = draftEditingCopy[language], locale = accessibilityLanguages[language];
  const scroll = useRef<ScrollView>(null);
  const positions = useRef({ content: 0, form: 0, notice: 0 });
  const submitted = useRef(false);
  const [focused, setFocused] = useState(false);
  const busy = state.phase === 'loading' || state.phase === 'saving';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const visible = state.phase !== 'loading' && !accessFailed && !!state.draft;
  const editable = visible && (state.phase === 'editing' || state.phase === 'saved');
  const message = state.validation ? text.validation[state.validation] : state.error ? text.errors[state.error]
    : state.phase === 'loading' ? text.loading : state.phase === 'saving' ? text.saving
      : state.phase === 'uncertain' ? text.uncertain : state.phase === 'conflict' ? text.conflict
        : state.phase === 'saved' && state.draft ? text.saved : null;
  const canRetry = visible && state.canRetry && (state.phase === 'uncertain' || state.phase === 'error');
  const reveal = useCallback(() => {
    if (message) scroll.current?.scrollTo({ y: Math.max(0, positions.current.content + positions.current.form + positions.current.notice - 16), animated: false });
  }, [message]);
  useEffect(() => { submitted.current = false; }, [state]);
  useEffect(() => {
    const hide = Keyboard.addListener('keyboardDidHide', reveal), show = Keyboard.addListener('keyboardDidShow', reveal);
    return () => { hide.remove(); show.remove(); };
  }, [reveal]);
  useEffect(() => {
    if (!message) return;
    if (state.validation || state.error || state.phase === 'conflict' || state.phase === 'uncertain') {
      Keyboard.dismiss(); reveal();
    }
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message, state.validation, state.error, state.phase, reveal]);
  const save = () => {
    if (!editable || !state.dirty || submitted.current) return;
    submitted.current = true; Keyboard.dismiss();
    if (state.validation) {
      reveal();
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.validation[state.validation]);
    }
    onSave();
  };
  const act = (callback: () => void) => { Keyboard.dismiss(); callback(); };
  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen scrollViewRef={scroll} onContentLayout={event => { positions.current.content = event.nativeEvent.layout.y; reveal(); }}>
      <MemyBrand />
      <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.editorTitle}</Text>
      {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[storyLanguage]}
        allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
      <View style={styles.form} accessibilityState={{ busy }} testID="draft-editor-form"
        onLayout={event => { positions.current.form = event.nativeEvent.layout.y; reveal(); }}>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
        {message && <Text accessibilityRole={state.validation || state.error || state.phase === 'conflict' || state.phase === 'uncertain' ? 'alert' : undefined}
          accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.notice} testID="draft-editor-notice"
          onLayout={event => { positions.current.notice = event.nativeEvent.layout.y; reveal(); }}>{message}</Text>}
        {state.phase === 'uncertain' && state.error && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
        {visible && <>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.privacy}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.preservation}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
            {text.language}: {storyLanguage === 'sv' ? text.swedish : text.english}
          </Text>
          {state.phase === 'conflict' && state.compare && <View style={styles.comparison}>
            <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.remote}</Text>
            <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{state.compare.content}</Text>
          </View>}
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{state.phase === 'conflict' ? text.local : text.field}</Text>
          <TextInput value={state.text} onChangeText={value => { if (editable) onChangeText(value); }} editable={editable}
            accessibilityLabel={text.field} accessibilityLanguage={accessibilityLanguages[storyLanguage]}
            accessibilityHint={state.validation ? text.validation[state.validation] + ' ' + text.help : text.help}
            allowFontScaling multiline textAlignVertical="top" autoCapitalize="sentences" autoCorrect
            submitBehavior="newline" onSubmitEditing={() => Keyboard.dismiss()}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.input, focused && styles.focused]} />
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.help}</Text>
          {editable && <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{state.dirty ? text.dirty : text.unchanged}</Text>}
          <DraftEditingButton language={language} label={text.done} disabled={busy} onPress={() => Keyboard.dismiss()} />
          {state.phase === 'conflict' && state.compare ? <>
            <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.keepMineHelp}</Text>
            <DraftEditingButton language={language} label={text.keepMine} primary onPress={() => act(onKeepMine)} />
            <DraftEditingButton language={language} label={text.useLatest} onPress={() => act(onUseLatest)} />
          </> : <>
            {editable && <DraftEditingButton language={language} label={text.save} primary disabled={!state.dirty} onPress={save} />}
            {(state.phase === 'uncertain' || state.phase === 'error' || state.phase === 'conflict') &&
              <DraftEditingButton language={language} label={text.check} primary={!canRetry} onPress={() => act(onCheck)} />}
            {canRetry && <>
              <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.retryHelp}</Text>
              <DraftEditingButton language={language} label={text.retry} primary onPress={() => {
                if (submitted.current) return; submitted.current = true; act(onRetry);
              }} />
            </>}
          </>}
        </>}
        {!visible && state.phase === 'error' && !accessFailed && <DraftEditingButton language={language} label={text.check} primary onPress={onCheck} />}
        <DraftEditingButton language={language} label={text.back} primary={state.phase === 'saved' && !state.error} onPress={() => act(onBack)} />
        <DraftEditingButton language={language} label={text.signOut} onPress={() => act(onSignOut)} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  keyboard: { flex: 1 }, form: { width: '100%', gap: 24 }, comparison: { width: '100%', gap: 16, padding: 16,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.selected },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  input: { width: '100%', minHeight: 260, borderWidth: 2, borderColor: colors.border, borderRadius: layout.controlRadius,
    backgroundColor: colors.paper, color: colors.ink, fontSize: 22, lineHeight: 34, padding: 16 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderRadius: layout.controlRadius, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest }, secondary: { backgroundColor: colors.paper, borderColor: colors.forest },
  disabled: { borderColor: colors.muted }, disabledPrimary: { backgroundColor: colors.muted }, focused: { borderColor: colors.ink }, pressed: { borderColor: colors.ink },
  buttonText: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryText: { color: colors.paper },
});
