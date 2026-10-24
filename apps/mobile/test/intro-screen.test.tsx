import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedMemoryBook } from '../src/components/AnimatedMemoryBook';
import { accessibilityLanguages, type Language } from '../src/i18n';
import { introCopy, type IntroScene } from '../src/intro-copy';
import { IntroductionScreen } from '../src/screens/IntroductionScreen';
import { WelcomeScreen } from '../src/screens/WelcomeScreen';
import { useReducedMotion } from '../src/useReducedMotion';

jest.mock('../src/components/AnimatedMemoryBook', () => ({
  AnimatedMemoryBook: jest.fn(() => null),
}));
jest.mock('../src/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => true) }));

function callbacks() {
  return { onNext: jest.fn(), onBack: jest.fn(), onSkip: jest.fn(), onEnter: jest.fn() };
}

describe('native introduction screens', () => {
  beforeEach(() => jest.mocked(useReducedMotion).mockReturnValue(true));

  const cases = (['en', 'sv'] as const).flatMap((language) => (
    ([0, 1, 2] as const).map((scene) => ({ language, scene }))
  ));

  it.each(cases)('shows approved translated content for $language scene $scene', ({ language, scene }) => {
    render(<IntroductionScreen language={language} scene={scene} {...callbacks()} />);
    const text = introCopy[language];
    expect(screen.getByRole('header', { name: text.scenes[scene].title })).toBeOnTheScreen();
    expect(screen.getByText(text.scenes[scene].eyebrow)).toBeOnTheScreen();
    expect(screen.getByText(text.scenes[scene].description)).toBeOnTheScreen();
    expect(screen.getByText(text.scenes[scene].caption)).toBeOnTheScreen();
    expect(screen.getByText(text.illustration)).toBeOnTheScreen();
    expect(screen.getByText(text.progress(scene + 1)).props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByText('Memy')).toBeOnTheScreen();
    expect(jest.mocked(AnimatedMemoryBook)).toHaveBeenLastCalledWith(
      { scene, language, motion: false }, undefined,
    );
  });

  it.each([0, 1] as IntroScene[])('offers controlled Next and Skip on scene %s', (scene) => {
    const actions = callbacks();
    render(<IntroductionScreen language="en" scene={scene} {...actions} />);
    expect(actions.onNext).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(actions.onNext).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(actions.onSkip).toHaveBeenCalledTimes(1);
    expect(actions.onEnter).not.toHaveBeenCalled();
  });

  it('offers Back on the first scene so language can be corrected, and on later scenes', () => {
    const actions = callbacks();
    const view = render(<IntroductionScreen language="en" scene={0} {...actions} />);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(actions.onBack).toHaveBeenCalledTimes(1);
    view.rerender(<IntroductionScreen language="en" scene={1} {...actions} />);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(actions.onBack).toHaveBeenCalledTimes(2);
  });

  it.each<Language>(['en', 'sv'])('offers Enter, Back and Skip on the final %s scene', (language) => {
    const actions = callbacks();
    render(<IntroductionScreen language={language} scene={2} {...actions} />);
    const text = introCopy[language];
    expect(screen.queryByRole('button', { name: text.next })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: text.enter }));
    fireEvent.press(screen.getByRole('button', { name: text.back }));
    fireEvent.press(screen.getByRole('button', { name: text.skip }));
    expect(actions.onEnter).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
    expect(actions.onSkip).toHaveBeenCalledTimes(1);
    expect(actions.onNext).not.toHaveBeenCalled();
  });

  it('passes system motion permission to the native illustration without advancing', () => {
    jest.mocked(useReducedMotion).mockReturnValue(false);
    const actions = callbacks();
    render(<IntroductionScreen language="en" scene={0} {...actions} />);
    expect(jest.mocked(AnimatedMemoryBook)).toHaveBeenLastCalledWith(
      { scene: 0, language: 'en', motion: true }, undefined,
    );
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it.each(cases)('keeps $language scene $scene readable, scrollable and safe for large text', ({ language, scene }) => {
    render(<IntroductionScreen language={language} scene={scene} {...callbacks()} />);
    for (const node of screen.UNSAFE_getAllByType(Text)) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(node.props.style)?.height).toBeUndefined();
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minHeight: 56, width: '100%' });
      expect(button.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    }
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).not.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('native Welcome introduction controls', () => {
  it.each<Language>(['en', 'sv'])('explains unavailable future actions without fake controls in %s', (language) => {
    const onReplayIntroduction = jest.fn();
    render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} onReplayIntroduction={onReplayIntroduction} />);
    const text = introCopy[language];
    expect(screen.getByText(text.unavailable)).toBeOnTheScreen();
    for (const label of [text.login, text.register, text.guest]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(onReplayIntroduction).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: text.replay }));
    expect(onReplayIntroduction).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('displays an honest %s note only when device storage is unavailable', (language) => {
    const view = render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} />);
    expect(screen.queryByText(introCopy[language].storageNote)).toBeNull();
    view.rerender(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} storageUnavailable />);
    expect(screen.getByText(introCopy[language].storageNote)).toBeOnTheScreen();
  });
});

describe('scene heading focus for native screen readers', () => {
  let frame: Parameters<typeof requestAnimationFrame>[0];

  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 7;
    });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  function renderScene() {
    return render(<IntroductionScreen language="en" scene={0} {...callbacks()} />);
  }

  function layOutHeading() {
    fireEvent(screen.getByRole('header'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 90 } },
    });
  }

  it('focuses the laid-out native heading only when a screen reader is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    renderScene();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    layOutHeading();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frame(0));
    const expectedHeading = screen.UNSAFE_getAllByType(Text)
      .find((node) => node.props.accessibilityRole === 'header')?.instance;
    const calls = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe('focus');
    // RN's Text mock assigns its composite instance to ref. Check identity
    // without asking Jest to recursively serialize that instance's Fiber tree.
    expect(calls[0]?.[0] === expectedHeading).toBe(true);
  });

  it('does not move regular keyboard focus when a screen reader is disabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    renderScene();
    layOutHeading();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('does not refocus after language or repeated layout changes', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const view = renderScene();
    layOutHeading();
    await act(async () => {});
    act(() => frame(0));
    view.rerender(<IntroductionScreen language="sv" scene={0} {...callbacks()} />);
    layOutHeading();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores a device query that finishes after the screen unmounts', async () => {
    let resolve: (enabled: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    const view = renderScene();
    layOutHeading();
    view.unmount();
    await act(async () => resolve(true));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('cancels pending frame work and guards even a stale callback after unmount', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const view = renderScene();
    layOutHeading();
    await act(async () => {});
    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    act(() => frame(0));
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('leaves focus unchanged when the device query fails', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockRejectedValue(new Error('Unavailable'));
    renderScene();
    layOutHeading();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('handles unavailable native focus without interrupting navigation', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockImplementation(() => {
      throw new Error('Unavailable');
    });
    renderScene();
    layOutHeading();
    await act(async () => {});
    expect(() => act(() => frame(0))).not.toThrow();
    expect(screen.getByRole('button', { name: 'Next' })).toBeOnTheScreen();
  });
});
