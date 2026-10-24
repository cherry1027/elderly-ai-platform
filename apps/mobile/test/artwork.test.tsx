import { nativeNodes, nativeNode, nativeText } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

import { AnimatedMemoryBook } from '../src/components/AnimatedMemoryBook';

describe('the actual native memory book artwork', () => {
  const animations: { start: jest.Mock; stop: jest.Mock; reset: jest.Mock }[] = [];
  let timing: jest.SpyInstance;

  beforeEach(() => {
    animations.length = 0;
    timing = jest.spyOn(Animated, 'timing').mockImplementation(() => {
      const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
      animations.push(animation);
      return animation;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([0, 1, 2] as const)('renders the authored book and valid native vector geometry for scene %s', async (scene) => {
    await render(<AnimatedMemoryBook scene={scene} language="en" motion={false} />);
    const paths = nativeNodes('path').map((node) => node.props.d as string);
    expect(paths).toContain('M123 204c81-33 171-26 257 16 88-42 178-49 259-16v299c-89-30-175-23-259 19-83-42-171-49-257-19Z');
    expect(paths).toContain('M380 215v269');
    for (const path of paths) {
      expect(path).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/);
    }
    for (const group of nativeNodes('svgGroup')) {
      if (typeof group.props.transform === 'string') expect(group.props.transform).not.toContain(':');
    }
    expect(screen.queryAllByRole('button', { includeHiddenElements: true })).toHaveLength(0);
    expect(timing).not.toHaveBeenCalled();
  });

  it('retains memory symbols, a voice/keyboard alternative and separate draft paragraphs', async () => {
    const view = await render(<AnimatedMemoryBook scene={0} language="en" motion={false} />);
    expect(nativeNodes('rect').some((node) => node.props.x === '94')).toBe(true);
    await view.rerender(<AnimatedMemoryBook scene={1} language="en" motion={false} />);
    const rectangles = nativeNodes('rect');
    expect(rectangles.some((node) => node.props.x === '255' && node.props.width === '16')).toBe(true);
    expect(rectangles.some((node) => node.props.x === '580' && node.props.width === '76')).toBe(true);
    await view.rerender(<AnimatedMemoryBook scene={2} language="en" motion={false} />);
    expect(screen.getByTestId('memory-book-paragraph-1', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('memory-book-paragraph-2', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(nativeText(nativeNode('svgText'))).toBe('DRAFT');
  });

  it.each([['en', 'DRAFT'], ['sv', 'UTKAST']] as const)('uses the correct decorative %s draft label', async (language, label) => {
    await render(<AnimatedMemoryBook scene={2} language={language} motion={false} />);
    expect(nativeText(nativeNode('svgText'))).toBe(label);
  });

  it.each([0, 1, 2] as const)('starts a finite non-blocking native animation for scene %s', async (scene) => {
    await render(<AnimatedMemoryBook scene={scene} language="en" motion />);
    expect(timing).toHaveBeenCalledTimes(1);
    const configuration = timing.mock.calls[0][1];
    expect(configuration).toEqual(expect.objectContaining({
      toValue: 1,
      useNativeDriver: true,
      isInteraction: false,
    }));
    expect(configuration.duration).toBeGreaterThan(0);
    expect(configuration.duration).toBeLessThanOrEqual(1500);
    expect(animations[0].start).toHaveBeenCalledTimes(1);
  });

  it('stops the old animation on a scene change and stops the new one on unmount', async () => {
    const view = await render(<AnimatedMemoryBook scene={0} language="en" motion />);
    await view.rerender(<AnimatedMemoryBook scene={1} language="en" motion />);
    expect(animations[0].stop).toHaveBeenCalledTimes(1);
    expect(animations[1].start).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(animations[1].stop).toHaveBeenCalledTimes(1);
  });

  it('stops immediately when reduced motion is requested without scheduling another animation', async () => {
    const view = await render(<AnimatedMemoryBook scene={0} language="en" motion />);
    await view.rerender(<AnimatedMemoryBook scene={0} language="en" motion={false} />);
    expect(animations[0].stop).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('memory-book-cover-turn', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
  });

  it('shows the settled static voice and draft illustrations when motion is disabled', async () => {
    const view = await render(<AnimatedMemoryBook scene={1} language="en" motion={false} />);
    expect(screen.getByTestId('memory-book-voice-wave', { includeHiddenElements: true })).toHaveStyle({ opacity: 0 });
    await view.rerender(<AnimatedMemoryBook scene={2} language="en" motion={false} />);
    for (const id of ['memory-book-paragraph-1', 'memory-book-paragraph-2']) {
      expect(screen.getByTestId(id, { includeHiddenElements: true })).toHaveStyle({ opacity: 1 });
    }
    expect(timing).not.toHaveBeenCalled();
  });

  it('does not restart animation when translating the same scene or measuring a smaller layout', async () => {
    const view = await render(<AnimatedMemoryBook scene={2} language="en" motion />);
    await view.rerender(<AnimatedMemoryBook scene={2} language="sv" motion />);
    const art = screen.getByTestId('memory-book-scene-3', { includeHiddenElements: true });
    await fireEvent(art, 'layout', { nativeEvent: { layout: { width: 280, height: 240, x: 0, y: 0 } } });
    expect(timing).toHaveBeenCalledTimes(1);
    expect(nativeText(nativeNode('svgText'))).toBe('UTKAST');
  });

  it('keeps all scenes decorative and responsive without application network operations', async () => {
    const view = await render(<AnimatedMemoryBook scene={0} language="en" motion={false} />);
    for (const scene of [0, 1, 2] as const) {
      await view.rerender(<AnimatedMemoryBook scene={scene} language="sv" motion={false} />);
      const art = screen.getByTestId(`memory-book-scene-${scene + 1}`, { includeHiddenElements: true });
      expect(art.props.accessible).toBe(false);
      expect(art.props.accessibilityElementsHidden).toBe(true);
      expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(art.props.pointerEvents).toBe('none');
      expect(StyleSheet.flatten(art.props.style)).toEqual(expect.objectContaining({
        width: '100%', maxWidth: 480, aspectRatio: 760 / 650,
      }));
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
    expect(globalThis.WebSocket).not.toHaveBeenCalled();
  });
});
