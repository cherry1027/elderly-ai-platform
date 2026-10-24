import { maybeComponent, getComponent } from './component-probe';
import { nativeNodes, nativeNode } from './native-tree';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MemoryBookArtwork, MemyBrand } from '../src/components/BrandArtwork';
import { LargeButton } from '../src/components/LargeButton';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { RootTabBar } from '../src/components/RootTabBar';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { rootNavigationCopy } from '../src/root-navigation-copy';
import { accessibilityLanguages, copy, type Language } from '../src/i18n';

jest.mock('../src/components/BrandArtwork', () => {
  const actual = jest.requireActual<typeof import('../src/components/BrandArtwork')>('../src/components/BrandArtwork');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, MemyBrand: observeComponent(actual.MemyBrand), MemoryBookArtwork: observeComponent(actual.MemoryBookArtwork) };
});

const languages: Language[] = ['en', 'sv'];
afterEach(async () => {
  await cleanup(); jest.restoreAllMocks();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it.each(languages)('refined %s Home retains Memy identity once, real actions and the original full artwork', async language => {
  const open = jest.fn(), create = jest.fn(), text = rootNavigationCopy[language];
  await render(<HomeScreen language={language} onOpenStories={open} onCreateStory={create} />);
  expect(screen.getByRole('header', { name: text.homeTitle })).toHaveTextContent(/Memy/);
  expect(maybeComponent(MemyBrand)).toBeNull();
  expect(screen.getByText(text.homeDescription)).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(getComponent(MemoryBookArtwork)).toBeDefined();
  const artwork = nativeNodes('view').find(node => StyleSheet.flatten(node.props.style)?.aspectRatio === 760 / 650)!;
  let ancestor = artwork.parent;
  while (ancestor && StyleSheet.flatten(ancestor.props.style)?.maxWidth !== 184) ancestor = ancestor.parent;
  expect(ancestor).not.toBeNull();
  expect(StyleSheet.flatten(ancestor!.props.style)).toMatchObject({ width: '100%', alignSelf: 'center' });
  expect(nativeNode('scroll').props.scrollEnabled).not.toBe(false);
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(button.props.style).height).toBeUndefined();
  }
  await fireEvent.press(screen.getByRole('button', { name: text.openStories }));
  await fireEvent.press(screen.getByRole('button', { name: text.createStory }));
  expect(open).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByText(text.simulation).props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
});

it.each(languages)('refined %s roots keep scaling/scrolling instead of hiding content to fit', async language => {
  const view = await render(<HomeScreen language={language} onOpenStories={jest.fn()} onCreateStory={jest.fn()} />);
  const check = () => {
    for (const text of nativeNodes('text')) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.adjustsFontSizeToFit).not.toBe(true);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.height).toBeUndefined();
    }
    expect(nativeNode('scroll').props.scrollEnabled).not.toBe(false);
  };
  check();
  await view.unmount();
  await render(<SettingsScreen language={language} onSelectLanguage={jest.fn()} onReplayIntroduction={jest.fn()} onSignOut={jest.fn()} />);
  check();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio')]) {
    expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(56);
  }
});

it.each(languages.flatMap(language => [375, 390].map(width => ({language, width}))))(
  '$language tabs at $width reserve more room for full long labels with no text shrinking', async ({language, width}) => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({width, height:844, scale:3, fontScale:1});
    const select = jest.fn(), text = rootNavigationCopy[language];
    await render(<RootTabBar language={language} tab="stories" onSelectTab={select} />);
    const group = screen.container.queryAll(node => node.props.accessibilityRole === 'tablist')[0];
    expect(StyleSheet.flatten(group.props.style).flexDirection).toBe('row');
    const home = screen.getByRole('tab', {name:text.tabs.home});
    const stories = screen.getByRole('tab', {name:text.tabs.stories});
    expect(StyleSheet.flatten(stories.props.style).flex).toBeGreaterThan(StyleSheet.flatten(home.props.style).flex);
    for (const tab of screen.getAllByRole('tab')) {
      const style = StyleSheet.flatten(tab.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(56);
      expect(style.minWidth).toBeGreaterThanOrEqual(56);
      expect(style.height).toBeUndefined();
      expect(tab.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
    }
    expect(stories.props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(text.tabs.stories)).toHaveStyle({fontWeight:'700',fontSize:20});
    const markers = nativeNodes('view').filter(node => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.width === 20 && style?.height === 3 && style?.opacity === 1;
    });
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0].props.accessibilityElementsHidden).toBe(true);
    await fireEvent.press(stories); expect(select).not.toHaveBeenCalled();
    await fireEvent.press(home); expect(select).toHaveBeenCalledWith('home');
    for (const label of nativeNodes('text')) {
      expect(label.props.allowFontScaling).toBe(true);
      expect(label.props.numberOfLines).toBeUndefined();
      expect(label.props.adjustsFontSizeToFit).not.toBe(true);
    }
  });

it.each(languages)('compact %s Settings language choice preserves checked/focus semantics and default entrance details', async language => {
  const select = jest.fn();
  const view = await render(<LanguageSelector language={language} onSelectLanguage={select} />);
  expect(screen.getByText(copy[language].selected)).toBeOnTheScreen();
  await view.rerender(<LanguageSelector language={language} onSelectLanguage={select} density="compact" />);
  expect(screen.queryByText(copy[language].selected)).toBeNull();
  const current = screen.getByRole('radio', {name:language === 'en' ? 'English' : 'Svenska'});
  expect(current.props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByRole('radio', {name:language === 'en' ? 'Svenska' : 'English'}));
  expect(select).toHaveBeenCalledWith(language === 'en' ? 'sv' : 'en');
});

it('compact button density preserves disabled behavior, full labels and the default entrance size', async () => {
  const press = jest.fn();
  const view = await render(<LargeButton label="Öppna min sparade berättelse" language="sv" onPress={press} />);
  const original = StyleSheet.flatten(screen.getByRole('button').props.style);
  await view.rerender(<LargeButton label="Öppna min sparade berättelse" language="sv" onPress={press} density="compact" disabled />);
  const compact = screen.getByRole('button'), style = StyleSheet.flatten(compact.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(56);
  expect(style.paddingVertical).toBeLessThan(original.paddingVertical);
  expect(compact).toBeDisabled(); await fireEvent.press(compact); expect(press).not.toHaveBeenCalled();
  const label = screen.getByText('Öppna min sparade berättelse');
  expect(label).toHaveStyle({fontSize:22, lineHeight:32});
  expect(label.props.allowFontScaling).toBe(true); expect(label.props.numberOfLines).toBeUndefined();
});
