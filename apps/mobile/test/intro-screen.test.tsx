import { getComponent, getComponents } from './component-probe';
import { nativeNodes, nativeNode, nativeRef } from './native-tree';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
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

  it.each(cases)('shows approved translated content for $language scene $scene', async ({ language, scene }) => {
    await render(<IntroductionScreen language={language} scene={scene} {...callbacks()} />);
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

  it.each([0, 1] as IntroScene[])('offers controlled Next and Skip on scene %s', async (scene) => {
    const actions = callbacks();
    await render(<IntroductionScreen language="en" scene={scene} {...actions} />);
    expect(actions.onNext).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(actions.onNext).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(actions.onSkip).toHaveBeenCalledTimes(1);
    expect(actions.onEnter).not.toHaveBeenCalled();
  });

  it('offers Back on the first scene so language can be corrected, and on later scenes', async () => {
    const actions = callbacks();
    const view = await render(<IntroductionScreen language="en" scene={0} {...actions} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(actions.onBack).toHaveBeenCalledTimes(1);
    await view.rerender(<IntroductionScreen language="en" scene={1} {...actions} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(actions.onBack).toHaveBeenCalledTimes(2);
  });

  it.each<Language>(['en', 'sv'])('offers Enter, Back and Skip on the final %s scene', async (language) => {
    const actions = callbacks();
    await render(<IntroductionScreen language={language} scene={2} {...actions} />);
    const text = introCopy[language];
    expect(screen.queryByRole('button', { name: text.next })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: text.enter }));
    await fireEvent.press(screen.getByRole('button', { name: text.back }));
    await fireEvent.press(screen.getByRole('button', { name: text.skip }));
    expect(actions.onEnter).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
    expect(actions.onSkip).toHaveBeenCalledTimes(1);
    expect(actions.onNext).not.toHaveBeenCalled();
  });

  it('passes system motion permission to the native illustration without advancing', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(false);
    const actions = callbacks();
    await render(<IntroductionScreen language="en" scene={0} {...actions} />);
    expect(jest.mocked(AnimatedMemoryBook)).toHaveBeenLastCalledWith(
      { scene: 0, language: 'en', motion: true }, undefined,
    );
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it.each(cases)('keeps $language scene $scene readable, scrollable and safe for large text', async ({ language, scene }) => {
    await render(<IntroductionScreen language={language} scene={scene} {...callbacks()} />);
    for (const node of nativeNodes('text')) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(node.props.style)?.height).toBeUndefined();
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minHeight: 56, width: '100%' });
      expect(button.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    }
    expect(getComponent(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(nativeNode('scroll').props.scrollEnabled).not.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('native Welcome introduction controls', () => {
  it.each<Language>(['en', 'sv'])('explains unavailable future actions without fake controls in %s', async (language) => {
    const onReplayIntroduction = jest.fn();
    await render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} onReplayIntroduction={onReplayIntroduction} />);
    const text = introCopy[language];
    expect(screen.getByText(text.unavailable)).toBeOnTheScreen();
    for (const label of [text.login, text.register, text.guest]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(onReplayIntroduction).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: text.replay }));
    expect(onReplayIntroduction).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('displays an honest %s note only when device storage is unavailable', async (language) => {
    const view = await render(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} />);
    expect(screen.queryByText(introCopy[language].storageNote)).toBeNull();
    await view.rerender(<WelcomeScreen language={language} onChangeLanguage={jest.fn()} storageUnavailable />);
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

  async function renderScene() {
    return await render(<IntroductionScreen language="en" scene={0} {...callbacks()} />);
  }

  async function layOutHeading() {
    await fireEvent(screen.getByRole('header'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 90 } },
    });
  }

  it('focuses the laid-out native heading only when a screen reader is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    await renderScene();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    await layOutHeading();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    await act(() => frame(0));
    const expectedHeading = nativeRef(getComponents(Text)
      .find(node => node.props.accessibilityRole === 'header')?.props.ref);
    const calls = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toBe('focus');
    // Compare the public native ref forwarded by the real Text boundary.
    expect(calls[0]?.[0] === expectedHeading).toBe(true);
  });

  it('does not move regular keyboard focus when a screen reader is disabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    await renderScene();
    await layOutHeading();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('does not refocus after language or repeated layout changes', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const view = await renderScene();
    await layOutHeading();
    await act(async () => {});
    await act(() => frame(0));
    await view.rerender(<IntroductionScreen language="sv" scene={0} {...callbacks()} />);
    await layOutHeading();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores a device query that finishes after the screen unmounts', async () => {
    let resolve: (enabled: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    const view = await renderScene();
    await layOutHeading();
    await view.unmount();
    await act(async () => resolve(true));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('cancels pending frame work and guards even a stale callback after unmount', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const view = await renderScene();
    await layOutHeading();
    await act(async () => {});
    await view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    await act(() => frame(0));
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('leaves focus unchanged when the device query fails', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockRejectedValue(new Error('Unavailable'));
    await renderScene();
    await layOutHeading();
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });

  it('handles unavailable native focus without interrupting navigation', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockImplementation(() => {
      throw new Error('Unavailable');
    });
    await renderScene();
    await layOutHeading();
    await act(async () => {});
    await expect(act(() => frame(0))).resolves.toBeUndefined();
    expect(screen.getByRole('button', { name: 'Next' })).toBeOnTheScreen();
  });
});
