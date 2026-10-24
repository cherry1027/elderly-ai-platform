import { getComponent } from './component-probe';
import { nativeNodes, nativeNode, nativeRef, contentLayout } from './native-tree';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, type KeyboardEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import { createStoryCopy } from '../src/create-story-copy';
import type { Language } from '../src/i18n';
import { Screen } from '../src/components/Screen';
import { CreateStoryScreen, type CreateStoryState } from '../src/screens/CreateStoryScreen';
import { colors } from '../src/theme';
import { leaveCopy } from '../src/navigation/useGuardedLeave';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});

const idle: CreateStoryState = { status: 'idle' };
const project: StoryProject = {
  id: 'synthetic-project-created', title: 'Ett barndomsminne', description: null, language: 'sv', status: 'draft',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
async function setup(props: Partial<React.ComponentProps<typeof CreateStoryScreen>> = {}) {
  const callbacks = { onSubmit: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const initial = { ...callbacks, language: 'en' as Language, state: idle, serviceAvailable: true, ...props };
  const view = await render(<CreateStoryScreen {...initial} />);
  return { ...callbacks, view, initial };
}

describe('native Create My Story form', () => {
  it.each<Language>(['en', 'sv'])('renders only title and language controls with localized labels in %s', async language => {
    await setup({ language });
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
    expect(nativeNodes('input')).toHaveLength(1);
    expect(screen.queryByText(/description|beskrivning|microphone|recording|AI|guest/i)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('requires a nonblank title before submitting in %s', async language => {
    const { onSubmit } = await setup({ language });
    const text = createStoryCopy[language];
    for (const value of ['', '   ', '\n\t']) {
      await fireEvent.changeText(screen.getByLabelText(text.titleLabel), value);
      await fireEvent.press(screen.getByRole('button', { name: text.create }));
      expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each((['en', 'sv'] as const).flatMap(language => [
    { name: 'empty', title: '', kind: 'required' as const },
    { name: 'whitespace-only', title: ' \t\n ', kind: 'required' as const },
    { name: 'overlong', title: 'a'.repeat(121), kind: 'too-long' as const },
  ].map(value => ({ language, ...value }))))('shows adjacent, readable $name feedback without reopening the keyboard in $language', async ({ language, title, kind }) => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = await setup({ language });
      const text = createStoryCopy[language];
      const expected = language === 'en'
        ? kind === 'required' ? 'Please enter a title for your story.' : 'Your story title must be 120 characters or fewer.'
        : kind === 'required' ? 'Ange en titel för din berättelse.' : 'Titeln får innehålla högst 120 tecken.';
      const input = screen.getByLabelText(text.titleLabel);
      await fireEvent.changeText(input, title);
      await fireEvent.press(screen.getByRole('button', { name: text.create }));
      const alert = within(screen.getByTestId('create-story-title-field')).getByRole('alert');
      expect(alert).toHaveTextContent(expected);
      expect(alert).toHaveStyle({ fontSize: 22, lineHeight: 32 });
      expect(alert.props.allowFontScaling).toBe(true);
      expect(input.props.value).toBe(title);
      expect(input.props.accessibilityHint).toBe(`${expected} ${text.titleHelp}`);
      expect(input.props.autoFocus).not.toBe(true);
      expect(input).toHaveStyle({ borderColor: colors.border });
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { dismiss.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('keeps invalid feedback through edits and language choices until the title is corrected in %s', async language => {
    const { onSubmit } = await setup({ language });
    const text = createStoryCopy[language];
    const input = screen.getByLabelText(text.titleLabel);
    await fireEvent.press(screen.getByRole('button', { name: text.create }));
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    await fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? text.english : text.swedish }));
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    await fireEvent.changeText(input, 'a'.repeat(121));
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation['too-long']);
    await fireEvent.changeText(input, '\u0085\u200b');
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    await fireEvent.changeText(input, 'Ett tydligt minne');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.props.accessibilityHint).toBe(text.titleHelp);
    expect(onSubmit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each((['en', 'sv'] as const).flatMap(language => (['ios', 'android'] as const).map(platform => ({ language, platform }))))(
    'uses one platform-appropriate error announcement per invalid attempt in $language on $platform', async ({ language, platform }) => {
      const original = AccessibilityInfo.announceForAccessibility;
      const announce = jest.fn();
      const os = jest.replaceProperty(Platform, 'OS', platform);
      AccessibilityInfo.announceForAccessibility = announce;
      let view: Awaited<ReturnType<typeof render>> | undefined;
      try {
        ({ view } = await setup({ language }));
        const text = createStoryCopy[language];
        const create = screen.getByRole('button', { name: text.create });
        await fireEvent.press(create); await fireEvent.press(create);
        const alert = screen.getByRole('alert');
        if (platform === 'ios') {
          expect(announce).toHaveBeenCalledTimes(2);
          expect(announce).toHaveBeenNthCalledWith(1, text.validation.required);
          expect(announce).toHaveBeenNthCalledWith(2, text.validation.required);
          expect(alert.props.accessibilityLiveRegion).toBeUndefined();
        } else {
          expect(announce).not.toHaveBeenCalled();
          expect(alert.props.accessibilityLiveRegion).toBe('assertive');
        }
      } finally { await view?.unmount(); AccessibilityInfo.announceForAccessibility = original; os.restore(); }
    });

  it.each<Language>(['en', 'sv'])('reveals the title field after layout and keyboard hide/show, then cleans up both listeners in %s', async language => {
    const original = Keyboard.addListener;
    const subscriptions: { name: 'keyboardDidHide' | 'keyboardDidShow'; listener: (event: KeyboardEvent) => void; remove: jest.Mock }[] = [];
    Keyboard.addListener = ((name, listener) => {
      if (name !== 'keyboardDidHide' && name !== 'keyboardDidShow') return original.call(Keyboard, name, listener);
      const subscription = { name: name as 'keyboardDidHide' | 'keyboardDidShow', listener: listener as (event: KeyboardEvent) => void, remove: jest.fn() };
      subscriptions.push(subscription);
      return { remove: subscription.remove };
    }) as typeof Keyboard.addListener;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      ({ view } = await setup({ language }));
      const scrollTo = jest.fn();
      const container = getComponent(Screen);
      jest.spyOn(nativeRef(container.props.scrollViewRef), 'scrollTo').mockImplementation(scrollTo);
      const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 320, height: 200 } } });
      await contentLayout(container.props.onContentLayout, 24);
      await fireEvent(screen.getByTestId('create-story-form'), 'layout', layout(180));
      await fireEvent(screen.getByTestId('create-story-title-field'), 'layout', layout(70));
      expect(scrollTo).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: createStoryCopy[language].create }));
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 258, animated: false });
      await fireEvent(screen.getByTestId('create-story-form'), 'layout', layout(140));
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 218, animated: false });
      const keyboardHidden: KeyboardEvent = { duration: 0, easing: 'keyboard',
        endCoordinates: { screenX: 0, screenY: 800, width: 390, height: 0 } };
      const hide = subscriptions.filter(subscription => subscription.name === 'keyboardDidHide').at(-1)!.listener;
      const show = subscriptions.filter(subscription => subscription.name === 'keyboardDidShow').at(-1)!.listener;
      scrollTo.mockClear();
      await act(() => hide(keyboardHidden));
      expect(scrollTo).toHaveBeenCalledWith({ y: 218, animated: false });
      scrollTo.mockClear();
      await act(() => show({ ...keyboardHidden, endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 300 } }));
      expect(scrollTo).toHaveBeenCalledWith({ y: 218, animated: false });
      await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), 'A corrected title');
      scrollTo.mockClear(); await act(() => { hide(keyboardHidden); show(keyboardHidden); });
      expect(scrollTo).not.toHaveBeenCalled();
      await view.unmount(); view = undefined;
      expect(subscriptions.length).toBeGreaterThan(0);
      for (const subscription of subscriptions) expect(subscription.remove).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { await view?.unmount(); Keyboard.addListener = original; }
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
  ].map(value => ({ language, ...value }))))('rejects $name before callbacks in $language', async ({ language, title, kind }) => {
    const { onSubmit } = await setup({ language });
    const text = createStoryCopy[language];
    const input = screen.getByLabelText(text.titleLabel);
    await fireEvent.changeText(input, title);
    await fireEvent.press(screen.getByRole('button', { name: text.create }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // Component-tree presence does not establish physical iPhone visibility.
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation[kind]);
    expect(input.props.value).toBe(title);
    expect(screen.queryByText(text.success)).toBeNull();
  });

  it('trims the submitted title and sends only the two approved fields', async () => {
    const { onSubmit } = await setup();
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), '  A synthetic memory  ');
    await fireEvent.press(screen.getByRole('radio', { name: createStoryCopy.en.swedish }));
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A synthetic memory', language: 'sv' });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual(['language', 'title']);
    expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
    expect(screen.getByLabelText(createStoryCopy.en.titleLabel).props.value).toBe('  A synthetic memory  ');
  });

  it('accepts 120 Unicode code points without a UTF-16 maxLength truncation', async () => {
    const { onSubmit } = await setup();
    const title = '📖'.repeat(120);
    const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
    expect(input.props.maxLength).toBeUndefined();
    await fireEvent.changeText(input, title);
    expect(input.props.value).toBe(title);
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title, language: 'en' });
  });

  it.each(['a'.repeat(121), '📖'.repeat(121)])('preserves an overlong title for correction instead of silently truncating (%#)', async title => {
    const { onSubmit } = await setup();
    const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
    await fireEvent.changeText(input, title);
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.en.validation['too-long']);
    expect(input.props.value).toBe(title);
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.changeText(input, 'A corrected title');
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A corrected title', language: 'en' });
  });

  it.each<Language>(['en', 'sv'])('Done dismisses the keyboard without submitting or clearing text in %s', async language => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = await setup({ language });
      const input = screen.getByLabelText(createStoryCopy[language].titleLabel);
      await fireEvent.changeText(input, 'A synthetic title');
      await fireEvent(input, 'submitEditing');
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(input.props.value).toBe('A synthetic title');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { dismiss.mockRestore(); }
  });

  it('preserves title and the chosen story language when the interface language changes', async () => {
    const { view, initial } = await setup();
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    await fireEvent.press(screen.getByRole('radio', { name: createStoryCopy.en.english }));
    await view.rerender(<CreateStoryScreen {...initial} language="sv" />);
    expect(screen.getByLabelText(createStoryCopy.sv.titleLabel).props.value).toBe('A synthetic title');
    expect(screen.getByRole('radio', { name: createStoryCopy.sv.english })).toBeChecked();
    expect(screen.getByRole('radio', { name: createStoryCopy.sv.swedish })).not.toBeChecked();
  });

  it('ignores repeated native button events before the controller updates state', async () => {
    const { onSubmit } = await setup();
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    const create = screen.getByRole('button', { name: createStoryCopy.en.create });
    await fireEvent.press(create); await fireEvent.press(create);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('clearly explains the unconfigured service while keeping local validation usable in %s', async language => {
    const { onSubmit } = await setup({ language, serviceAvailable: false });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.unavailable)).toBeOnTheScreen();
    const create = screen.getByRole('button', { name: text.create });
    expect(create).toBeEnabled(); await fireEvent.press(create);
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.required);
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A synthetic title');
    await fireEvent.press(create);
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A synthetic title', language });
    expect(screen.queryByText(text.success)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('disables editing and duplicate saves while saving but keeps Cancel and Sign Out available in %s', async language => {
    const { onSubmit, onBack, onSignOut } = await setup({ language, state: { status: 'saving' } });
    const text = createStoryCopy[language];
    const create = screen.getByRole('button', { name: text.saving });
    expect(create).toBeDisabled(); expect(create.props.accessibilityState.busy).toBe(true);
    expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(false);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    await fireEvent.press(create); expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(text.savingWarning)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: text.cancel }));
    expect(onBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].leave }));
    await fireEvent.press(screen.getByRole('button', { name: text.signOut }));
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].leave }));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(createStoryCopy.en.errors) as StoryProjectsErrorKind[])('shows safe translated guidance for %s', async error => {
    await setup({ language: 'sv', state: { status: 'error', error, uncertain: false } });
    expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.sv.errors[error]);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.getByRole('button', { name: createStoryCopy.sv.signOut })).toBeEnabled();
    expect(screen.getByRole('button', { name: createStoryCopy.sv.back })).toBeEnabled();
    const create = screen.getByRole('button', { name: createStoryCopy.sv.create });
    if (error === 'authentication') expect(create).toBeDisabled();
    else expect(create).toBeEnabled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps a recoverable failure retryable without creating a local success', async () => {
    const { onSubmit, view, initial } = await setup();
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A synthetic title');
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    await view.rerender(<CreateStoryScreen {...initial} state={{ status: 'error', error: 'unavailable', uncertain: false }} />);
    await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
  });

  it.each<Language>(['en', 'sv'])('prevents blind retries when the service outcome is uncertain in %s', async language => {
    const { onSubmit, onBack } = await setup({ language, state: { status: 'error', error: 'timeout', uncertain: true } });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
    expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(false);
    const create = screen.getByRole('button', { name: text.create });
    expect(create).toBeDisabled(); await fireEvent.press(create);
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: text.back }));
    expect(onBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].leave }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('shows success only for the confirmed project and permits no second creation in %s', async language => {
    const { onSubmit, onBack, onSignOut } = await setup({ language, state: { status: 'success', project } });
    const text = createStoryCopy[language];
    expect(screen.getByText(text.success).props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByRole('header', { name: project.title }).props.accessibilityLanguage).toBe('sv-SE');
    expect(screen.getByText(`${text.savedLanguage}: ${text.swedish}`)).toBeOnTheScreen();
    expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: text.create })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: text.back }));
    await fireEvent.press(screen.getByRole('button', { name: text.signOut }));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['back', 'signOut'] as const)('clears the in-memory title before %s and never writes it to storage or logs', async action => {
    const log = jest.spyOn(console, 'log');
    try {
      const { onBack, onSignOut } = await setup();
      const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
      await fireEvent.changeText(input, 'Private synthetic title sentinel');
      await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en[action] }));
      expect(input.props.value).toBe('Private synthetic title sentinel');
      await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
      expect(input.props.value).toBe('');
      expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it.each<Language>(['en', 'sv'])('keeps controls large, text scalable, focus visible and the native form scrollable in %s', async language => {
    await setup({ language });
    const text = createStoryCopy[language];
    for (const button of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio')]) {
      expect(button).toHaveStyle({ minHeight: 56 });
    }
    const input = screen.getByLabelText(text.titleLabel);
    expect(input).toHaveStyle({ minHeight: 56, fontSize: 22 });
    expect(input.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
    await fireEvent(input, 'focus'); expect(input).toHaveStyle({ borderColor: colors.ink });
    await fireEvent(input, 'blur'); expect(input).toHaveStyle({ borderColor: colors.border });
    const radio = screen.getByRole('radio', { name: text.swedish });
    await fireEvent(radio, 'focus'); expect(radio).toHaveStyle({ borderColor: colors.ink });
    await fireEvent(radio, 'blur'); expect(radio).toHaveStyle({ borderColor: colors.forest });
    const create = screen.getByRole('button', { name: text.create });
    await fireEvent(create, 'focus'); expect(create).toHaveStyle({ borderColor: colors.ink });
    await fireEvent(create, 'blur'); expect(create).toHaveStyle({ borderColor: colors.forest });
    for (const node of nativeNodes('text')) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined(); expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
    }
    expect(getComponent(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(nativeNode('scroll').props.keyboardShouldPersistTaps).toBe('handled');
    expect(getComponent(KeyboardAvoidingView)).toBeTruthy();
  });
});
