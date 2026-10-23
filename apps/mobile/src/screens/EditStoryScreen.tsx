import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CreateStoryInputError, UpdateStoryInputError, validateUpdateStoryInput,
  type StoryProject, type StoryProjectsErrorKind, type UpdateStoryProjectInput,
} from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { storyDetailsCopy } from '../story-details-copy';
import { colors, headingFont, layout } from '../theme';

export type EditStoryState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'error'; error: StoryProjectsErrorKind; uncertain: boolean };

type FieldError = { field: 'title' | 'description'; kind: CreateStoryInputError['kind'] | 'description' | 'payload' };

interface EditStoryScreenProps {
  language: Language;
  project: StoryProject;
  state: EditStoryState;
  onSubmit: (input: UpdateStoryProjectInput) => void;
  onBack: () => void;
  onSignOut: () => void;
}

function fieldError(error: unknown): FieldError {
  if (error instanceof CreateStoryInputError) return { field: 'title', kind: error.kind };
  if (error instanceof UpdateStoryInputError && error.kind === 'description') return { field: 'description', kind: 'description' };
  return { field: 'title', kind: 'payload' };
}

export function EditStoryScreen({ language, project, state, onSubmit, onBack, onSignOut }: EditStoryScreenProps) {
  const text = storyDetailsCopy[language];
  const { waiting } = useApiBackoff();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [validation, setValidation] = useState<FieldError | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const offsets = useRef({ content: 0, form: 0, title: 0, description: 0 });
  const revealPending = useRef<FieldError['field'] | null>(null);
  const serviceRevealPending = useRef(false);
  const submitted = useRef(false);
  const saving = state.status === 'saving';
  const uncertain = state.status === 'error' && state.uncertain;
  const disabled = saving || uncertain || (state.status === 'error' && state.error === 'authentication');
  const message = validation ? validation.kind === 'payload' ? text.errors.validation : text.validation[validation.kind] : null;
  const serviceMessage = state.status === 'error' ? state.error === 'configuration' ? text.unavailable : text.errors[state.error] : null;

  useEffect(() => { submitted.current = false; }, [state]);
  const revealError = useCallback(() => {
    const field = revealPending.current;
    if (!field && !serviceRevealPending.current) return;
    scrollView.current?.scrollTo({ y: Math.max(0, offsets.current.content + offsets.current.form + (field ? offsets.current[field] : 0) - 16), animated: false });
  }, []);
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', revealError);
    const shown = Keyboard.addListener('keyboardDidShow', revealError);
    return () => { hidden.remove(); shown.remove(); };
  }, [revealError]);
  useEffect(() => {
    if (!message) return;
    revealError();
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message, revealError, validationAttempt]);
  useEffect(() => {
    serviceRevealPending.current = !!serviceMessage;
    if (serviceMessage) revealError();
    if (serviceMessage && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(uncertain ? `${serviceMessage} ${text.uncertain}` : serviceMessage);
    }
  }, [revealError, serviceMessage, text.uncertain, uncertain]);

  function validateDraft(nextTitle: string, nextDescription: string) {
    return validateUpdateStoryInput({ title: nextTitle, description: nextDescription === '' ? null : nextDescription });
  }
  function clearValidation() { revealPending.current = null; setValidation(null); }
  function revalidate(nextTitle: string, nextDescription: string) {
    if (!validation) return;
    try { validateDraft(nextTitle, nextDescription); clearValidation(); }
    catch (error) { const next = fieldError(error); revealPending.current = next.field; setValidation(next); }
  }
  function submit() {
    if (waiting || disabled || submitted.current) return;
    serviceRevealPending.current = false;
    let input: UpdateStoryProjectInput;
    try { input = validateDraft(title, description); }
    catch (error) {
      const next = fieldError(error); revealPending.current = next.field; setValidation(next);
      setValidationAttempt(attempt => attempt + 1); Keyboard.dismiss(); return;
    }
    clearValidation(); submitted.current = true; Keyboard.dismiss(); onSubmit(input);
  }
  function leave(callback: () => void) {
    serviceRevealPending.current = false;
    setTitle(''); setDescription(''); clearValidation(); Keyboard.dismiss(); callback();
  }

  function alert(field: FieldError['field']) {
    return validation?.field === field && message ? <Text accessibilityRole="alert"
      accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
      accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{message}</Text> : null;
  }

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen scrollViewRef={scrollView} onContentLayout={event => { offsets.current.content = event.nativeEvent.layout.y; revealError(); }}>
      <MemyBrand />
      <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.editTitle}</Text>
      <View style={styles.form} accessibilityState={{ busy: saving }} testID="edit-story-form"
        onLayout={event => { offsets.current.form = event.nativeEvent.layout.y; revealError(); }}>
        {!validation && serviceMessage && <Text accessibilityRole="alert"
          accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{serviceMessage}</Text>}
        {uncertain && <Text accessibilityRole="alert" accessibilityLiveRegion={Platform.OS === 'android' ? 'assertive' : undefined}
          accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
        <View style={styles.field} testID="edit-story-title-field"
          onLayout={event => { offsets.current.title = event.nativeEvent.layout.y; revealError(); }}>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>{text.titleLabel}</Text>
          {alert('title')}
          <TextInput value={title} onChangeText={value => { serviceRevealPending.current = false; setTitle(value); revalidate(value, description); }}
            accessibilityLabel={text.titleLabel} accessibilityHint={validation?.field === 'title' ? `${message} ${text.titleHelp}` : text.titleHelp}
            accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling editable={!disabled}
            style={[styles.input, focused === 'title' && styles.focused]} autoCapitalize="sentences" autoCorrect
            returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
            onFocus={() => { serviceRevealPending.current = false; setFocused('title'); }} onBlur={() => setFocused(null)} />
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.help}>{text.titleHelp}</Text>
        </View>
        <View style={styles.field} testID="edit-story-description-field"
          onLayout={event => { offsets.current.description = event.nativeEvent.layout.y; revealError(); }}>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>{text.descriptionLabel}</Text>
          {alert('description')}
          <TextInput value={description} onChangeText={value => { serviceRevealPending.current = false; setDescription(value); revalidate(title, value); }}
            accessibilityLabel={text.descriptionLabel} accessibilityHint={validation?.field === 'description' ? `${message} ${text.descriptionHelp}` : text.descriptionHelp}
            accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling editable={!disabled}
            style={[styles.input, styles.description, focused === 'description' && styles.focused]}
            multiline submitBehavior="newline" textAlignVertical="top" autoCapitalize="sentences" autoCorrect
            onFocus={() => { serviceRevealPending.current = false; setFocused('description'); }} onBlur={() => setFocused(null)} />
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.help}>{text.descriptionHelp}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={text.done} accessibilityLanguage={accessibilityLanguages[language]}
          accessibilityState={{ disabled }} disabled={disabled} onPress={() => Keyboard.dismiss()}
          onFocus={() => setFocused('done')} onBlur={() => setFocused(null)}
          style={({ pressed }) => [styles.action, styles.secondary, pressed && !disabled && styles.pressed,
            focused === 'done' && styles.focused, disabled && styles.disabled]}>
          <Text allowFontScaling style={[styles.actionLabel, styles.secondaryLabel]}>{text.done}</Text>
        </Pressable>
        <View style={styles.field}>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>
            {text.language}: {project.language === 'sv' ? text.swedish : text.english}
          </Text>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.help}>{text.languageHelp}</Text>
        </View>
        {saving && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={styles.notice}>{text.savingWarning}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={saving ? text.saving : text.save}
          accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ disabled: disabled || waiting, busy: saving }} disabled={disabled || waiting}
          onPress={submit} onFocus={() => setFocused('save')} onBlur={() => setFocused(null)}
          style={({ pressed }) => [styles.action, pressed && !disabled && !waiting && styles.pressed,
            focused === 'save' && styles.focused, (disabled || waiting) && styles.disabled]}>
          <Text allowFontScaling style={styles.actionLabel}>{saving ? text.saving : text.save}</Text>
        </Pressable>
        <LargeButton label={text.cancel} language={language} variant="secondary" onPress={() => leave(onBack)} />
        <LargeButton label={text.signOut} language={language} variant="secondary" onPress={() => leave(onSignOut)} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 }, heading: { fontFamily: headingFont }, form: { width: '100%', gap: 24 }, field: { width: '100%', gap: 12 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' }, help: { color: colors.muted, fontSize: 20, lineHeight: 30 },
  input: { minHeight: layout.minimumTouchTarget, width: '100%', padding: 16, borderWidth: 2, borderColor: colors.border,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper, color: colors.ink, fontSize: 22, lineHeight: 32 },
  description: { minHeight: 160 }, notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  action: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.paper }, actionLabel: { color: colors.paper, fontSize: 22, lineHeight: 32,
    fontWeight: '600', textAlign: 'center', flexShrink: 1 }, secondaryLabel: { color: colors.forest },
  disabled: { opacity: 0.65 }, pressed: { opacity: 0.8 }, focused: { borderColor: colors.ink },
});
