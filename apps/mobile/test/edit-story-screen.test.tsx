import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, type KeyboardEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import { Screen } from '../src/components/Screen';
import type { Language } from '../src/i18n';
import { EditStoryScreen, type EditStoryState } from '../src/screens/EditStoryScreen';
import { storyDetailsCopy } from '../src/story-details-copy';
import { colors } from '../src/theme';

const project: StoryProject = {
  id: '10000000-0000-4000-8000-000000000001', title: 'Ett barndomsminne', description: 'En syntetisk beskrivning.', language: 'sv', status: 'draft',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const idle: EditStoryState = { status: 'idle' };
function setup(props: Partial<React.ComponentProps<typeof EditStoryScreen>> = {}) {
  const callbacks = { onSubmit: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const initial = { ...callbacks, language: 'en' as Language, project, state: idle, ...props };
  const view = render(<EditStoryScreen {...initial} />);
  return { ...callbacks, initial, view };
}

describe('native Edit Story form', () => {
  it.each<Language>(['en', 'sv'])('prefills only title and description and shows read-only story language in %s', language => {
    const { onSubmit } = setup({ language });
    const text = storyDetailsCopy[language];
    expect(screen.getByRole('header', { name: text.editTitle })).toBeOnTheScreen();
    expect(screen.getByLabelText(text.titleLabel).props.value).toBe(project.title);
    expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe(project.description);
    expect(screen.getByText(`${text.language}: ${text.swedish}`)).toBeOnTheScreen();
    expect(screen.getByText(text.languageHelp)).toBeOnTheScreen();
    expect(screen.UNSAFE_getAllByType(TextInput)).toHaveLength(2);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submits only the trimmed title and exact multiline description without language or ownership fields', () => {
    const { onSubmit } = setup();
    const text = storyDetailsCopy.en;
    const description = '  My first line\nA second line with  two spaces.\t ';
    fireEvent.changeText(screen.getByLabelText(text.titleLabel), '  A synthetic memory  ');
    fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), description);
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'A synthetic memory', description });
    expect(Object.keys(onSubmit.mock.calls[0][0]).sort()).toEqual(['description', 'title']);
    expect(screen.queryByText(text.saved)).toBeNull();
    expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe(description);
  });

  it.each(['', '  \n\t  '])('converts only an actually empty description to null (%#)', description => {
    const { onSubmit } = setup({ project: { ...project, description: null } });
    const text = storyDetailsCopy.en;
    expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe('');
    fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), description);
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    expect(onSubmit).toHaveBeenCalledWith({ title: project.title, description: description === '' ? null : description });
  });

  it.each((['en', 'sv'] as const).flatMap(language => [
    { name: 'empty', title: '', kind: 'required' as const },
    { name: 'whitespace-only', title: '\u0085 \t', kind: 'required' as const },
    { name: 'invisible-only', title: '\u200b\u2060', kind: 'required' as const },
    { name: 'overlong', title: '📖'.repeat(121), kind: 'too-long' as const },
  ].map(value => ({ language, ...value }))))('rejects $name title adjacent to its field before any callback in $language', ({ language, title, kind }) => {
    const { onSubmit } = setup({ language });
    const text = storyDetailsCopy[language];
    const input = screen.getByLabelText(text.titleLabel);
    fireEvent.changeText(input, title);
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    expect(onSubmit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('edit-story-title-field')).getByRole('alert')).toHaveTextContent(text.validation[kind]);
    expect(input.props.accessibilityHint).toBe(`${text.validation[kind]} ${text.titleHelp}`);
    expect(input.props.value).toBe(title); expect(input.props.maxLength).toBeUndefined();
    expect(screen.queryByText(text.saved)).toBeNull();
  });

  it.each<Language>(['en', 'sv'])('accepts the 120/4000 Unicode code-point boundaries without truncation in %s', language => {
    const { onSubmit } = setup({ language });
    const text = storyDetailsCopy[language];
    const title = '📖'.repeat(120), description = '📖'.repeat(4000);
    fireEvent.changeText(screen.getByLabelText(text.titleLabel), title);
    fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), description);
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    expect(onSubmit).toHaveBeenCalledWith({ title, description });
    expect(screen.getByLabelText(text.descriptionLabel).props.maxLength).toBeUndefined();
  });

  it.each<Language>(['en', 'sv'])('rejects an overlong description by its own field and keeps invalid feedback until corrected in %s', language => {
    const { onSubmit } = setup({ language });
    const text = storyDetailsCopy[language];
    const input = screen.getByLabelText(text.descriptionLabel);
    fireEvent.changeText(input, '📖'.repeat(4001));
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    expect(within(screen.getByTestId('edit-story-description-field')).getByRole('alert')).toHaveTextContent(text.validation.description);
    expect(input.props.accessibilityHint).toBe(`${text.validation.description} ${text.descriptionHelp}`);
    fireEvent.changeText(input, 'x'.repeat(4001));
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation.description);
    fireEvent.changeText(input, 'An exact\ncorrected description ');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('dismisses using title Done or the explicit Done button without saving or erasing in %s', language => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const { onSubmit } = setup({ language });
      const text = storyDetailsCopy[language];
      const title = screen.getByLabelText(text.titleLabel), description = screen.getByLabelText(text.descriptionLabel);
      fireEvent.changeText(title, 'A draft title'); fireEvent.changeText(description, 'First line\nSecond line');
      fireEvent(title, 'submitEditing');
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(description.props.multiline).toBe(true); expect(description.props.submitBehavior).toBe('newline');
      expect(description.props.onSubmitEditing).toBeUndefined();
      fireEvent.press(screen.getByRole('button', { name: text.done }));
      expect(dismiss).toHaveBeenCalledTimes(2);
      expect(title.props.value).toBe('A draft title'); expect(description.props.value).toBe('First line\nSecond line');
      expect(onSubmit).not.toHaveBeenCalled();
    } finally { dismiss.mockRestore(); }
  });

  it('prevents duplicate native Save presses before parent state changes', () => {
    const { onSubmit } = setup();
    const save = screen.getByRole('button', { name: storyDetailsCopy.en.save });
    fireEvent.press(save); fireEvent.press(save); expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('retains current draft through a recoverable failure and interface-language change in %s', language => {
    const { view, initial, onSubmit } = setup({ language });
    const text = storyDetailsCopy[language];
    fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A private synthetic draft');
    fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), '  Exact\n spacing  ');
    fireEvent.press(screen.getByRole('button', { name: text.save }));
    const other = language === 'sv' ? 'en' : 'sv';
    view.rerender(<EditStoryScreen {...initial} language={other} state={{ status: 'error', error: 'validation', uncertain: false }} />);
    expect(screen.getByLabelText(storyDetailsCopy[other].titleLabel).props.value).toBe('A private synthetic draft');
    expect(screen.getByLabelText(storyDetailsCopy[other].descriptionLabel).props.value).toBe('  Exact\n spacing  ');
    fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy[other].save }));
    expect(onSubmit).toHaveBeenCalledTimes(2); expect(screen.queryByText(storyDetailsCopy[other].saved)).toBeNull();
  });

  it.each<Language>(['en', 'sv'])('locks editing while saving but always permits Cancel and Sign Out in %s', language => {
    const { onSubmit, onBack, onSignOut } = setup({ language, state: { status: 'saving' } });
    const text = storyDetailsCopy[language];
    const save = screen.getByRole('button', { name: text.saving });
    expect(save).toBeDisabled(); expect(save.props.accessibilityState.busy).toBe(true);
    for (const label of [text.titleLabel, text.descriptionLabel]) expect(screen.getByLabelText(label).props.editable).toBe(false);
    expect(screen.getByRole('button', { name: text.done })).toBeDisabled();
    fireEvent.press(save); expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(text.savingWarning)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: text.cancel }));
    fireEvent.press(screen.getByRole('button', { name: text.signOut }));
    expect(onBack).toHaveBeenCalledTimes(1); expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(storyDetailsCopy.en.errors) as StoryProjectsErrorKind[])('uses safe localized error guidance for %s', error => {
    setup({ language: 'sv', state: { status: 'error', error, uncertain: false } });
    const text = storyDetailsCopy.sv;
    expect(screen.getByRole('alert')).toHaveTextContent(error === 'configuration' ? text.unavailable : text.errors[error]);
    expect(screen.getByRole('button', { name: text.cancel })).toBeEnabled();
    expect(screen.getByRole('button', { name: text.signOut })).toBeEnabled();
    const save = screen.getByRole('button', { name: text.save });
    if (error === 'authentication') expect(save).toBeDisabled(); else expect(save).toBeEnabled();
    expect(screen.queryByText(text.saved)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('prevents blind retries after an uncertain result in %s', language => {
    const { onSubmit } = setup({ language, state: { status: 'error', error: 'timeout', uncertain: true } });
    const text = storyDetailsCopy[language];
    expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
    const save = screen.getByRole('button', { name: text.save });
    expect(save).toBeDisabled(); fireEvent.press(save);
    expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(false);
    expect(screen.getByLabelText(text.descriptionLabel).props.editable).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'signOut'] as const)('clears memory on %s without storage writes or logging draft contents', action => {
    const log = jest.spyOn(console, 'log');
    try {
      const { onBack, onSignOut } = setup();
      const text = storyDetailsCopy.en;
      fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'Private synthetic title');
      fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'Private synthetic description');
      fireEvent.press(screen.getByRole('button', { name: text[action] }));
      expect(screen.getByLabelText(text.titleLabel).props.value).toBe('');
      expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe('');
      expect(action === 'cancel' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it.each((['en', 'sv'] as const).flatMap(language => (['ios', 'android'] as const).map(platform => ({ language, platform }))))(
    'announces repeated local failures appropriately in $language on $platform', ({ language, platform }) => {
      const original = AccessibilityInfo.announceForAccessibility, announce = jest.fn();
      const os = jest.replaceProperty(Platform, 'OS', platform);
      AccessibilityInfo.announceForAccessibility = announce;
      let view: ReturnType<typeof render> | undefined;
      try {
        ({ view } = setup({ language }));
        const text = storyDetailsCopy[language];
        fireEvent.changeText(screen.getByLabelText(text.titleLabel), '');
        const save = screen.getByRole('button', { name: text.save });
        fireEvent.press(save); fireEvent.press(save);
        if (platform === 'ios') {
          expect(announce).toHaveBeenCalledTimes(2); expect(announce).toHaveBeenLastCalledWith(text.validation.required);
          expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBeUndefined();
        } else {
          expect(announce).not.toHaveBeenCalled(); expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
        }
      } finally { view?.unmount(); AccessibilityInfo.announceForAccessibility = original; os.restore(); }
    });

  it.each<Language>(['en', 'sv'])('scrolls the actual invalid field after layout/keyboard changes and removes listeners in %s', language => {
    const original = Keyboard.addListener;
    const subscriptions: { name: 'keyboardDidHide' | 'keyboardDidShow'; listener: (event: KeyboardEvent) => void; remove: jest.Mock }[] = [];
    Keyboard.addListener = ((name, listener) => {
      if (name !== 'keyboardDidHide' && name !== 'keyboardDidShow') return original.call(Keyboard, name, listener);
      const subscription = { name, listener, remove: jest.fn() }; subscriptions.push(subscription);
      return { remove: subscription.remove };
    }) as typeof Keyboard.addListener;
    let view: ReturnType<typeof render> | undefined;
    try {
      ({ view } = setup({ language }));
      const scrollTo = jest.fn(), container = screen.UNSAFE_getByType(Screen);
      container.props.scrollViewRef.current = { scrollTo };
      const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 320, height: 200 } } });
      act(() => container.props.onContentLayout(layout(24)));
      fireEvent(screen.getByTestId('edit-story-form'), 'layout', layout(180));
      fireEvent(screen.getByTestId('edit-story-title-field'), 'layout', layout(70));
      fireEvent(screen.getByTestId('edit-story-description-field'), 'layout', layout(290));
      const text = storyDetailsCopy[language];
      fireEvent.changeText(screen.getByLabelText(text.titleLabel), '');
      fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'a'.repeat(4001));
      fireEvent.press(screen.getByRole('button', { name: text.save }));
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 258, animated: false });
      fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A corrected title');
      expect(within(screen.getByTestId('edit-story-description-field')).getByRole('alert')).toHaveTextContent(text.validation.description);
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 478, animated: false });
      const event: KeyboardEvent = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 800, width: 390, height: 0 } };
      const hide = subscriptions.filter(item => item.name === 'keyboardDidHide').at(-1)!.listener;
      const show = subscriptions.filter(item => item.name === 'keyboardDidShow').at(-1)!.listener;
      scrollTo.mockClear(); act(() => { hide(event); show(event); });
      expect(scrollTo).toHaveBeenCalledTimes(2);
      fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'Corrected description');
      scrollTo.mockClear(); act(() => { hide(event); show(event); }); expect(scrollTo).not.toHaveBeenCalled();
      view.unmount(); view = undefined;
      for (const subscription of subscriptions) expect(subscription.remove).toHaveBeenCalledTimes(1);
    } finally { view?.unmount(); Keyboard.addListener = original; }
  });

  it.each((['en', 'sv'] as const).flatMap(language => [false, true].map(uncertain => ({ language, uncertain }))))(
    'reveals a new service failure after saving in $language (uncertain=$uncertain) without retrying or erasing the draft', ({ language, uncertain }) => {
      const originalListener = Keyboard.addListener, originalAnnouncement = AccessibilityInfo.announceForAccessibility;
      const announce = jest.fn(), os = jest.replaceProperty(Platform, 'OS', 'ios');
      const subscriptions: { name: 'keyboardDidHide' | 'keyboardDidShow'; listener: (event: KeyboardEvent) => void; remove: jest.Mock }[] = [];
      Keyboard.addListener = ((name, listener) => {
        if (name !== 'keyboardDidHide' && name !== 'keyboardDidShow') return originalListener.call(Keyboard, name, listener);
        const subscription = { name, listener, remove: jest.fn() }; subscriptions.push(subscription);
        return { remove: subscription.remove };
      }) as typeof Keyboard.addListener;
      AccessibilityInfo.announceForAccessibility = announce;
      let view: ReturnType<typeof render> | undefined;
      try {
        const opened = setup({ language }); view = opened.view;
        const text = storyDetailsCopy[language], scrollTo = jest.fn();
        const container = screen.UNSAFE_getByType(Screen);
        container.props.scrollViewRef.current = { scrollTo };
        const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 320, height: 200 } } });
        act(() => container.props.onContentLayout(layout(24)));
        fireEvent(screen.getByTestId('edit-story-form'), 'layout', layout(180));
        fireEvent.changeText(screen.getByLabelText(text.titleLabel), '  A private synthetic draft  ');
        fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), '  Exact\nprivate draft spacing  ');
        fireEvent.press(screen.getByRole('button', { name: text.save }));
        expect(opened.onSubmit).toHaveBeenCalledTimes(1);
        view.rerender(<EditStoryScreen {...opened.initial} state={{ status: 'saving' }} />);
        expect(scrollTo).not.toHaveBeenCalled();
        view.rerender(<EditStoryScreen {...opened.initial} state={{ status: 'error', error: 'network', uncertain }} />);
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 188, animated: false });
        expect(announce).toHaveBeenCalledWith(uncertain ? `${text.errors.network} ${text.uncertain}` : text.errors.network);
        expect(screen.getByLabelText(text.titleLabel).props.value).toBe('  A private synthetic draft  ');
        expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe('  Exact\nprivate draft spacing  ');
        fireEvent(screen.getByTestId('edit-story-form'), 'layout', layout(220));
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 228, animated: false });
        const event: KeyboardEvent = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 800, width: 390, height: 0 } };
        const hide = subscriptions.filter(item => item.name === 'keyboardDidHide').at(-1)!.listener;
        const show = subscriptions.filter(item => item.name === 'keyboardDidShow').at(-1)!.listener;
        scrollTo.mockClear(); act(() => { hide(event); show(event); });
        expect(scrollTo).toHaveBeenCalledTimes(2);
        if (!uncertain) {
          fireEvent(screen.getByLabelText(text.titleLabel), 'focus');
          scrollTo.mockClear(); act(() => { hide(event); show(event); });
          expect(scrollTo).not.toHaveBeenCalled();
          view.rerender(<EditStoryScreen {...opened.initial} state={{ status: 'saving' }} />);
          view.rerender(<EditStoryScreen {...opened.initial} state={{ status: 'error', error: 'validation', uncertain: false }} />);
          expect(scrollTo).toHaveBeenCalledWith({ y: 228, animated: false });
          fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'Updated draft, still not saved');
          scrollTo.mockClear(); act(() => { hide(event); show(event); });
          fireEvent(screen.getByTestId('edit-story-form'), 'layout', layout(230));
          expect(scrollTo).not.toHaveBeenCalled();
        } else expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
        expect(opened.onSubmit).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(text.saved)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
        view.unmount(); view = undefined;
        for (const subscription of subscriptions) expect(subscription.remove).toHaveBeenCalledTimes(1);
      } finally {
        view?.unmount(); Keyboard.addListener = originalListener;
        AccessibilityInfo.announceForAccessibility = originalAnnouncement; os.restore();
      }
    });

  it.each<Language>(['en', 'sv'])('uses large scalable native controls, focus, keyboard avoidance and safe-area scrolling in %s', language => {
    setup({ language });
    const text = storyDetailsCopy[language];
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const label of [text.titleLabel, text.descriptionLabel]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveStyle({ fontSize: 22 });
      fireEvent(input, 'focus'); expect(input).toHaveStyle({ borderColor: colors.ink });
      fireEvent(input, 'blur'); expect(input).toHaveStyle({ borderColor: colors.border });
    }
    for (const node of screen.UNSAFE_getAllByType(Text)) {
      expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
    }
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy();
  });
});
