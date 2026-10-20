import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import { createStoryCopy } from '../src/create-story-copy';
import type { Language } from '../src/i18n';
import { CreateStoryScreen, type CreateStoryState } from '../src/screens/CreateStoryScreen';
import { colors } from '../src/theme';

const idle: CreateStoryState = { status: 'idle' };
const project: StoryProject = {
  id: 'synthetic-project-created', title: 'Ett barndomsminne', description: null, language: 'sv', status: 'draft',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
function setup(props: Partial<React.ComponentProps<typeof CreateStoryScreen>> = {}) {
  const callbacks = { onSubmit: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const initial = { ...callbacks, language: 'en' as Language, state: idle, serviceAvailable: true, ...props };
  const view = render(<CreateStoryScreen {...initial} />);
  return { ...callbacks, view, initial };
}

describe('native Create My Story form', () => {
  it.each<Language>(['en', 'sv'])('renders only title and language controls with localized labels in %s', language => {
    setup({ language });
    const text = createStoryCopy[language];
    expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(text.titleLabel)).toBeOnTheScreen();
    expect(screen.getByText(text.projectLanguage)).toBeOnTheScreen();
    expect(screen.getByText(text.languageHelp)).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    for (const label of [text.english, text.swedish]) {
      const radio = screen.getByRole('radio', { name: label });
      expect(radio.props.accessibilityHint).toBe(`${text.projectLanguage}. ${text.languageHelp}`);
    }
    expect(screen.getByRole('radio', { name: language === 'sv' ? text.swedish : text.english })).toBeChecked();
    expect(screen.UNSAFE_getAllByType(TextInput)).toHaveLength(1);
    expect(screen.queryByText(/description|beskrivning|microphone|recording|AI|guest/i)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('requires a nonblank title before submitting in %s', language => {
    const { onSubmit } = setup({ language });
    const text = createStoryCopy[language];
    for (const value of ['', '   ', '\n\t']) {
      fireEvent.changeText(screen.getByLabelText(text.titleLabel), value);
      fireEvent.press(screen.getByRole('button', { name: text.create }));
      expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each((['en', 'sv'] as const).flatMap(language => [
    { name: 'U+0085 only', title: '\u0085', kind: 'required' as const },
    { name: 'U+0085 mixed with spaces', title: '\u0085 \u0085', kind: 'required' as const },
    { name: 'zero-width spaces only', title: '\u200b\u200b', kind: 'required' as const },
    { name: 'zero-width joiners only', title: '\u200c\u200d', kind: 'required' as const },
    { name: 'word joiners only', title: '\u2060\u2060', kind: 'required' as const },
    { name: 'byte-order marks only', title: '\ufeff\ufeff', kind: 'required' as const },
    { name: 'mixed invisible-only characters', title: '\u200b \u2060\ufeff', kind: 'required' as const },
    { name: 'ordinary whitespace only', title: ' \t\r\n ', kind: 'required' as const },
    { name: 'Unicode whitespace only', title: '\u00a0\u2003\u202f', kind: 'required' as const },
    { name: '121 ASCII code points', title: 'a'.repeat(121), kind: 'too-long' as const },
    { name: '121 supplementary code points', title: '📖'.repeat(121), kind: 'too-long' as const },
  ].map(value => ({ language, ...value }))))('rejects $name before callbacks in $language', ({ language, title, kind }) => {
    const { onSubmit } = setup({ language });
    const text = createStoryCopy[language];
    const input = screen.getByLabelText(text.titleLabel);
    fireEvent.changeText(input, title);
    fireEvent.press(screen.getByRole('button', { name: text.create }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // Component-tree presence does not establish physical iPhone visibility.
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation[kind]);
    expect(input.props.value).toBe(title);
    expect(screen.queryByText(text.success)).toBeNull();
  });

  it('trims the submitted title and sends only the two approved fields', () => {
    const { onSubmit } = setup();
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), '  A synthetic memory  ');
    fireEvent.press(screen.getByRole('radio', { name: createStoryCopy.en.swedish }));
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A synthetic memory', language: 'sv' });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual(['language', 'title']);
    expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
    expect(screen.getByLabelText(createStoryCopy.en.titleLabel).props.value).toBe('  A synthetic memory  ');
  });

  it('accepts 120 Unicode code points without a UTF-16 maxLength truncation', () => {
    const { onSubmit } = setup();
    const title = '📖'.repeat(120);
    const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
    expect(input.props.maxLength).toBeUndefined();
    fireEvent.changeText(input, title);
    expect(input.props.value).toBe(title);
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title, language: 'en' });
  });

  it.each(['a'.repeat(121), '📖'.repeat(121)])('preserves an overlong title for correction instead of silently truncating (%#)', title => {
    const { onSubmit } = setup();
    const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
    fireEvent.changeText(input, title);
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.en.validation['too-long']);
    expect(input.props.value).toBe(title);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.changeText(input, 'A corrected title');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A corrected title', language: 'en' });
  });

  it.each<Language>(['en', 'sv'])('Done dismisses the keyboard without submitting or clearing text in %s', language => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = setup({ language });
      const input = screen.getByLabelText(createStoryCopy[language].titleLabel);
      fireEvent.changeText(input, 'A synthetic title');
      fireEvent(input, 'submitEditing');
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(input.props.value).toBe('A synthetic title');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { dismiss.mockRestore(); }
  });

  it('preserves title and the chosen story language when the interface language changes', () => {
    const { view, initial } = setup();
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    fireEvent.press(screen.getByRole('radio', { name: createStoryCopy.en.english }));
    view.rerender(<CreateStoryScreen {...initial} language="sv" />);
    expect(screen.getByLabelText(createStoryCopy.sv.titleLabel).props.value).toBe('A synthetic title');
    expect(screen.getByRole('radio', { name: createStoryCopy.sv.english })).toBeChecked();
    expect(screen.getByRole('radio', { name: createStoryCopy.sv.swedish })).not.toBeChecked();
  });

  it('ignores repeated native button events before the controller updates state', () => {
    const { onSubmit } = setup();
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    const create = screen.getByRole('button', { name: createStoryCopy.en.create });
    fireEvent.press(create); fireEvent.press(create);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('clearly explains the unconfigured service while keeping local validation usable in %s', language => {
    const { onSubmit } = setup({ language, serviceAvailable: false });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.unavailable)).toBeOnTheScreen();
    const create = screen.getByRole('button', { name: text.create });
    expect(create).toBeEnabled(); fireEvent.press(create);
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A synthetic title');
    fireEvent.press(create);
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A synthetic title', language });
    expect(screen.queryByText(text.success)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('disables editing and duplicate saves while saving but keeps Cancel and Sign Out available in %s', language => {
    const { onSubmit, onBack, onSignOut } = setup({ language, state: { status: 'saving' } });
    const text = createStoryCopy[language];
    const create = screen.getByRole('button', { name: text.saving });
    expect(create).toBeDisabled(); expect(create.props.accessibilityState.busy).toBe(true);
    expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(false);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.press(create); expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(text.savingWarning)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: text.cancel }));
    fireEvent.press(screen.getByRole('button', { name: text.signOut }));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(createStoryCopy.en.errors) as StoryProjectsErrorKind[])('shows safe translated guidance for %s', error => {
    setup({ language: 'sv', state: { status: 'error', error, uncertain: false } });
    expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.sv.errors[error]);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.getByRole('button', { name: createStoryCopy.sv.signOut })).toBeEnabled();
    expect(screen.getByRole('button', { name: createStoryCopy.sv.back })).toBeEnabled();
    const create = screen.getByRole('button', { name: createStoryCopy.sv.create });
    if (error === 'authentication') expect(create).toBeDisabled();
    else expect(create).toBeEnabled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps a recoverable failure retryable without creating a local success', () => {
    const { onSubmit, view, initial } = setup();
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    view.rerender(<CreateStoryScreen {...initial} state={{ status: 'error', error: 'unavailable', uncertain: false }} />);
    fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
  });

  it.each<Language>(['en', 'sv'])('prevents blind retries when the service outcome is uncertain in %s', language => {
    const { onSubmit, onBack } = setup({ language, state: { status: 'error', error: 'timeout', uncertain: true } });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
    expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(false);
    const create = screen.getByRole('button', { name: text.create });
    expect(create).toBeDisabled(); fireEvent.press(create);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: text.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('shows success only for the confirmed project and permits no second creation in %s', language => {
    const { onSubmit, onBack, onSignOut } = setup({ language, state: { status: 'success', project } });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.success).props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByRole('header', { name: project.title }).props.accessibilityLanguage).toBe('sv-SE');
    expect(screen.getByText(`${text.savedLanguage}: ${text.swedish}`)).toBeOnTheScreen();
    expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: text.create })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: text.back }));
    fireEvent.press(screen.getByRole('button', { name: text.signOut }));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['back', 'signOut'] as const)('clears the in-memory title before %s and never writes it to storage or logs', action => {
    const log = jest.spyOn(console, 'log');
    try {
      const { onBack, onSignOut } = setup();
      const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
      fireEvent.changeText(input, 'Private synthetic title sentinel');
      fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en[action] }));
      expect(input.props.value).toBe('');
      expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('keeps controls large, text scalable, focus visible and the native form scrollable in %s', language => {
    setup({ language });
    const text = createStoryCopy[language];
    for (const button of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio')]) {
      expect(button).toHaveStyle({ minHeight: 56 });
    }
    const input = screen.getByLabelText(text.titleLabel);
    expect(input).toHaveStyle({ minHeight: 56, fontSize: 22 });
    expect(input.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
    fireEvent(input, 'focus'); expect(input).toHaveStyle({ borderColor: colors.ink });
    fireEvent(input, 'blur'); expect(input).toHaveStyle({ borderColor: colors.border });
    const radio = screen.getByRole('radio', { name: text.swedish });
    fireEvent(radio, 'focus'); expect(radio).toHaveStyle({ borderColor: colors.ink });
    fireEvent(radio, 'blur'); expect(radio).toHaveStyle({ borderColor: colors.forest });
    const create = screen.getByRole('button', { name: text.create });
    fireEvent(create, 'focus'); expect(create).toHaveStyle({ borderColor: colors.ink });
    fireEvent(create, 'blur'); expect(create).toHaveStyle({ borderColor: colors.forest });
    for (const node of screen.UNSAFE_getAllByType(Text)) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined(); expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
    }
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy();
  });
});
