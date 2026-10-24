import { getComponents, getComponent } from './component-probe';
import { nativeNodes, nativeNode } from './native-tree';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Native from 'react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { MyStoriesScreen } from '../src/screens/MyStoriesScreen';
import { RootTabBar } from '../src/components/RootTabBar';
import { LargeButton } from '../src/components/LargeButton';
import { Screen } from '../src/components/Screen';
import { AuthenticatedShell, RootScreenHeading } from '../src/navigation/AuthenticatedShell';
import { rootNavigationCopy, type RootTab } from '../src/root-navigation-copy';
import { accessibilityLanguages, type Language } from '../src/i18n';
import { storiesCopy } from '../src/stories-copy';
import { colors } from '../src/theme';

jest.mock('../src/components/RootTabBar', () => {
  const actual = jest.requireActual<typeof import('../src/components/RootTabBar')>('../src/components/RootTabBar');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, RootTabBar: observeComponent(actual.RootTabBar) };
});

const languages: Language[] = ['en', 'sv'];
const tabs: RootTab[] = ['home', 'stories', 'settings'];
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(languages)('Home has two real local actions and honest simulation copy in %s', async language => {
  const open = jest.fn(), create = jest.fn(), text = rootNavigationCopy[language];
  await render(<HomeScreen language={language} onOpenStories={open} onCreateStory={create} />);
  expect(screen.getByRole('header', { name: text.homeTitle })).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  await fireEvent.press(screen.getByRole('button', { name: text.openStories }));
  await fireEvent.press(screen.getByRole('button', { name: text.createStory }));
  expect(open).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(languages)('Settings exposes only supported language/replay/signout actions in %s', async language => {
  const select = jest.fn(), replay = jest.fn(), out = jest.fn(), text = rootNavigationCopy[language];
  await render(<SettingsScreen language={language} onSelectLanguage={select} onReplayIntroduction={replay}
    onSignOut={out} user={{ email: 'fictional@example.test' }} />);
  expect(screen.getByRole('header', { name: text.settingsTitle })).toBeOnTheScreen();
  expect(screen.getByText('fictional@example.test')).toBeOnTheScreen();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  const current = screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' });
  expect(current.props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? 'English' : 'Svenska' }));
  expect(select).toHaveBeenCalledWith(language === 'sv' ? 'en' : 'sv');
  await fireEvent.press(screen.getByRole('button', { name: text.replay }));
  await fireEvent.press(screen.getByRole('button', { name: text.signOut }));
  expect(replay).toHaveBeenCalledTimes(1); expect(out).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(languages.flatMap(language => tabs.map(tab => ({language, tab}))))(
  'root tabs have complete labels and explicit selected state: $language $tab', async ({language, tab}) => {
    const onSelect = jest.fn(), text = rootNavigationCopy[language];
    await render(<RootTabBar language={language} tab={tab} onSelectTab={onSelect} />);
    for (const item of tabs) {
      const target = screen.getByRole('tab', { name: text.tabs[item] });
      expect(target.props.accessibilityState).toMatchObject({ selected: item === tab });
      expect(target.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
      expect(StyleSheet.flatten(target.props.style).minHeight).toBeGreaterThanOrEqual(56);
      await fireEvent.press(target);
    }
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls.flat()).not.toContain(tab);
  });
it('root tabs wrap rather than shrink/truncate long Swedish text', async () => {
  jest.spyOn(Native.Dimensions, 'get').mockReturnValue({ width: 320, height: 600, scale: 2, fontScale: 2.5 });
  await render(<RootTabBar language="sv" tab="settings" onSelectTab={jest.fn()} />);
  // The group deliberately isn't one accessible element: each tab is reachable.
  const group = screen.container.queryAll(node => node.props.accessibilityRole === 'tablist')[0];
  expect(StyleSheet.flatten(group.props.style)).toMatchObject({ flexDirection: 'column' });
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true);
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.adjustsFontSizeToFit).not.toBe(true);
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
  }
  const target = screen.getByRole('tab', { name: rootNavigationCopy.sv.tabs.settings });
  await fireEvent(target, 'focus'); expect(target).toHaveStyle({ borderColor: colors.ink });
});
it('short landscape keeps a separate scrollable navigation area and space for page content', async () => {
  jest.spyOn(Native.Dimensions, 'get').mockReturnValue({width:568,height:320,scale:2,fontScale:3});
  await render(<RootTabBar language="sv" tab="settings" onSelectTab={jest.fn()} />);
  const scroll = nativeNode('scroll');
  expect(StyleSheet.flatten(scroll.props.style).maxHeight).toBeLessThan(160);
  expect(scroll.props.horizontal).not.toBe(true);
  expect(screen.getAllByRole('tab')).toHaveLength(3);
});
it('tab bar is outside scrolling content and owns the bottom safe area', async () => {
  await render(<AuthenticatedShell language="en" tab="home" onSelectTab={jest.fn()}>
    <HomeScreen language="en" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />
  </AuthenticatedShell>);
  expect(getComponent(RootTabBar)).toBeDefined();
  let ancestor = screen.getByRole('tab', { name: rootNavigationCopy.en.tabs.home }).parent;
  while (ancestor) { expect(ancestor.type).not.toBe('RCTScrollView'); ancestor = ancestor.parent; }
  const edges = getComponents(SafeAreaView).map(node => node.props.edges);
  expect(edges).toContainEqual(['top', 'left', 'right']);
  expect(edges).toContainEqual(['bottom', 'left', 'right']);
});
it('ordinary Screen defaults preserve entrance safe areas and centered layout', async () => {
  await render(<Screen><Text>Entrance</Text></Screen>);
  expect(getComponent(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
});
it.each(languages.flatMap(language => (['home', 'settings'] as const).map(kind => ({language, kind}))))(
  'root $kind preserves scalable text and large controls in $language', async ({language, kind}) => {
    await render(kind === 'home'
      ? <HomeScreen language={language} onOpenStories={jest.fn()} onCreateStory={jest.fn()} />
      : <SettingsScreen language={language} onSelectLanguage={jest.fn()} onReplayIntroduction={jest.fn()} onSignOut={jest.fn()} />);
    for (const node of nativeNodes('text')) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined(); expect(node.props.adjustsFontSizeToFit).not.toBe(true);
      expect(StyleSheet.flatten(node.props.style)?.height).toBeUndefined();
    }
    for (const target of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('radio')]) {
      expect(StyleSheet.flatten(target.props.style).minHeight).toBeGreaterThanOrEqual(56);
    }
  });
it.each(languages)('root My Stories keeps real cards but moves account/signout to Settings: %s', async language => {
  const text = storiesCopy[language], open = jest.fn();
  await render(<MyStoriesScreen root language={language} user={{ id:'account-a', email:'fictional@example.test' }}
    state={{ status:'ready', projects:[{id:'10000000-0000-4000-8000-000000000001',title:'A fictional title',
      description:null,language:'sv',status:'unexpected-status',created_at:'2026-10-20T10:00:00Z',updated_at:'2026-10-20T10:00:00Z'}] }}
    onRefresh={jest.fn()} onCreateStory={jest.fn()} onOpenStory={open} onSignOut={jest.fn()} />);
  expect(screen.queryByText('fictional@example.test')).toBeNull();
  expect(screen.queryByRole('button', {name:text.signOut})).toBeNull();
  expect(screen.getByText('A fictional title')).toBeOnTheScreen();
  expect(screen.getByText(text.language + ': ' + text.swedish)).toBeOnTheScreen();
  expect(screen.getByText(text.status + ': ' + text.otherStatus)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', {name:text.openStory + ': A fictional title'}));
  expect(open).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001');
});
it('LargeButton can provide context to VoiceOver without repeating long titles visually', async () => {
  const press = jest.fn();
  await render(<LargeButton label="Open Story" accessibilityLabel="Open story: Fictional title" language="en" onPress={press} />);
  expect(screen.getByText('Open Story')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', {name:'Open story: Fictional title'}));
  expect(press).toHaveBeenCalledTimes(1);
});

describe('root heading focus', () => {
  let frame: FrameRequestCallback;
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 7; });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });
  const layout = async () => await fireEvent(screen.getByRole('header'), 'layout', {nativeEvent:{layout:{x:0,y:0,width:300,height:80}}});
  it('focuses once after layout, without refocusing when language changes', async () => {
    jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(true);
    const view = await render(<RootScreenHeading language="en" title="Home" />);
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    await layout(); await act(() => frame(0));
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    await view.rerender(<RootScreenHeading language="sv" title="Hem" />); await layout();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
  it('cancels stale focus on unmount', async () => {
    jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(true);
    const view = await render(<RootScreenHeading language="en" title="Home" />); await layout(); await act(async () => {});
    await view.unmount(); expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    await act(() => frame(0)); expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });
  it.each(['disabled','rejected','throws'] as const)('keeps navigation operable when native focus query is %s', async mode => {
    const query = jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled');
    if (mode === 'disabled') query.mockResolvedValue(false);
    else if (mode === 'rejected') query.mockRejectedValue(new Error('Synthetic unavailable'));
    else query.mockImplementation(() => { throw new Error('Synthetic unavailable'); });
    await render(<RootScreenHeading language="sv" title="Hem" />); await layout(); await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled(); expect(screen.getByRole('header')).toBeOnTheScreen();
  });
});
