import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CreateStoryInputError, validateCreateStoryInput,
  type CreateStoryProjectInput, type StoryProject, type StoryProjectsErrorKind,
} from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { LargeButton } from '../components/LargeButton';
import { Screen, screenStyles } from '../components/Screen';
import { createStoryCopy } from '../create-story-copy';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';

export type CreateStoryState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'success'; project: StoryProject }
  | { status: 'error'; error: StoryProjectsErrorKind; uncertain: boolean };

interface CreateStoryScreenProps {
  language: Language;
  state: CreateStoryState;
  serviceAvailable: boolean;
  onSubmit: (input: CreateStoryProjectInput) => void;
  onBack: () => void;
  onSignOut: () => void;
}

export function CreateStoryScreen({ language, state, serviceAvailable, onSubmit, onBack, onSignOut }: CreateStoryScreenProps) {
  const text = createStoryCopy[language];
  const [title, setTitle] = useState('');
  const [projectLanguage, setProjectLanguage] = useState<Language>(language);
  const [validation, setValidation] = useState<CreateStoryInputError['kind'] | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const titleInput = useRef<TextInput>(null);
  const submitted = useRef(false);
  const saving = state.status === 'saving';
  const uncertain = state.status === 'error' && state.uncertain;
  const authenticationFailed = state.status === 'error' && state.error === 'authentication';
  const disabled = saving || uncertain || authenticationFailed || state.status === 'success';

  // The controller owns request cancellation and the API lock. This also ignores
  // repeated native button events before its next state reaches the form.
  useEffect(() => { submitted.current = false; }, [state]);

  function submit() {
    if (disabled || submitted.current) return;
    let input: CreateStoryProjectInput;
    try { input = validateCreateStoryInput({ title, language: projectLanguage }); }
    catch (error) {
      setValidation(error instanceof CreateStoryInputError ? error.kind : 'required');
      titleInput.current?.focus();
      return;
    }
    setValidation(null); submitted.current = true; Keyboard.dismiss(); onSubmit(input);
  }

  function leave(callback: () => void) {
    setTitle(''); setValidation(null); Keyboard.dismiss(); callback();
  }

  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <Screen>
      <MemyBrand />
      <View style={screenStyles.section}>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={[screenStyles.heading, styles.heading]}>{text.title}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={screenStyles.description}>{text.introduction}</Text>
      </View>
      <View style={styles.form} accessibilityState={{ busy: saving }}>
        {!serviceAvailable && state.status !== 'success' && <Text accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={styles.notice}>{text.unavailable}</Text>}
        {state.status === 'success' ? <View style={styles.success}>
          <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={styles.notice}>{text.success}</Text>
          <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[state.project.language]}
            allowFontScaling style={styles.savedTitle}>{state.project.title}</Text>
          <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>
            {text.savedLanguage}: {state.project.language === 'sv' ? text.swedish : text.english}
          </Text>
        </View> : <>
          {(validation || state.status === 'error') && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
            accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>
            {validation ? text.validation[validation] : state.status === 'error' ? text.errors[state.error] : null}
          </Text>}
          {uncertain && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive"
            accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
          <View style={styles.field}>
            <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>{text.titleLabel}</Text>
            <TextInput ref={titleInput} value={title} onChangeText={(value) => { setTitle(value); setValidation(null); }}
              accessibilityLabel={text.titleLabel} accessibilityHint={text.titleHelp}
              accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling editable={!disabled}
              style={[styles.input, focused === 'title' && styles.focused]} autoCapitalize="sentences"
              autoCorrect returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
              onFocus={() => setFocused('title')} onBlur={() => setFocused(null)} />
            <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.help}>{text.titleHelp}</Text>
          </View>
          <View style={styles.field} accessible={false} accessibilityRole="radiogroup" accessibilityLabel={text.projectLanguage}
            accessibilityLanguage={accessibilityLanguages[language]}>
            <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.label}>{text.projectLanguage}</Text>
            <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.help}>{text.languageHelp}</Text>
            {(['sv', 'en'] as const).map((value) => {
              const selected = projectLanguage === value;
              const label = value === 'sv' ? text.swedish : text.english;
              return <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
                accessibilityHint={`${text.projectLanguage}. ${text.languageHelp}`}
                accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ checked: selected, disabled }}
                disabled={disabled} onPress={() => { if (!disabled) { setProjectLanguage(value); setValidation(null); } }}
                onFocus={() => setFocused(value)} onBlur={() => setFocused(null)}
                style={({ pressed }) => [styles.action, styles.secondary, styles.radio, selected && styles.selected,
                  pressed && !disabled && styles.pressed, focused === value && styles.focused, disabled && styles.disabled]}>
                <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.radioCircle}>
                  {selected && <View style={styles.radioDot} />}
                </View>
                <Text allowFontScaling style={[styles.actionLabel, styles.secondaryLabel, styles.radioLabel]}>{label}</Text>
              </Pressable>;
            })}
          </View>
          {saving && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
            allowFontScaling style={styles.notice}>{text.savingWarning}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel={saving ? text.saving : text.create}
            accessibilityLanguage={accessibilityLanguages[language]} accessibilityState={{ disabled, busy: saving }} disabled={disabled}
            onPress={submit} onFocus={() => setFocused('create')} onBlur={() => setFocused(null)}
            style={({ pressed }) => [styles.action, pressed && !disabled && styles.pressed,
              focused === 'create' && styles.focused, disabled && styles.disabled]}>
            <Text allowFontScaling style={styles.actionLabel}>{saving ? text.saving : text.create}</Text>
          </Pressable>
        </>}
        <LargeButton label={saving ? text.cancel : text.back} language={language} variant="secondary" onPress={() => leave(onBack)} />
        <LargeButton label={text.signOut} language={language} variant="secondary" onPress={() => leave(onSignOut)} />
      </View>
    </Screen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 }, heading: { fontFamily: headingFont }, form: { width: '100%', gap: 24 },
  field: { width: '100%', gap: 12 }, label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30 },
  input: { minHeight: layout.minimumTouchTarget, width: '100%', padding: 16, borderWidth: 2,
    borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper,
    color: colors.ink, fontSize: 22, lineHeight: 32 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  action: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.paper }, selected: { backgroundColor: colors.selected },
  radio: { flexDirection: 'row', gap: 16, justifyContent: 'flex-start' },
  radioCircle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.forest,
    alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.forest }, radioLabel: { textAlign: 'left' },
  actionLabel: { color: colors.paper, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondaryLabel: { color: colors.forest }, disabled: { opacity: 0.65 }, pressed: { opacity: 0.8 },
  focused: { borderColor: colors.ink }, success: { width: '100%', gap: 20 },
  savedTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
});
