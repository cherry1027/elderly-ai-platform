import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Native from 'react-native';
import { AccessibilityInfo, ScrollView, StyleSheet, Text } from 'react-native';
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

const languages: Language[] = ['en', 'sv'];
const tabs: RootTab[] = ['home', 'stories', 'settings'];
afterEach(() => { cleanup(); jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(languages)('Home has two real local actions and honest simulation copy in %s', language => {
  const open = jest.fn(), create = jest.fn(), text = rootNavigationCopy[language];
  render(<HomeScreen language={language} onOpenStories={open} onCreateStory={create} />);
  expect(screen.getByRole('header', { name: text.homeTitle })).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: text.openStories }));
  fireEvent.press(screen.getByRole('button', { name: text.createStory }));
  expect(open).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(languages)('Settings exposes only supported language/replay/signout actions in %s', language => {
  const select = jest.fn(), replay = jest.fn(), out = jest.fn(), text = rootNavigationCopy[language];
  render(<SettingsScreen language={language} onSelectLanguage={select} onReplayIntroduction={replay}
    onSignOut={out} user={{ email: 'fictional@example.test' }} />);
  expect(screen.getByRole('header', { name: text.settingsTitle })).toBeOnTheScreen();
  expect(screen.getByText('fictional@example.test')).toBeOnTheScreen();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  const current = screen.getByRole('radio', { name: language === 'sv' ? 'Svenska' : 'English' });
  expect(current.props.accessibilityState).toMatchObject({ checked: true });
  fireEvent.press(screen.getByRole('radio', { name: language === 'sv' ? 'English' : 'Svenska' }));
  expect(select).toHaveBeenCalledWith(language === 'sv' ? 'en' : 'sv');
  fireEvent.press(screen.getByRole('button', { name: text.replay }));
  fireEvent.press(screen.getByRole('button', { name: text.signOut }));
  expect(replay).toHaveBeenCalledTimes(1); expect(out).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each(languages.flatMap(language => tabs.map(tab => ({language, tab}))))(
  'root tabs have complete labels and explicit selected state: $language $tab', ({language, tab}) => {
    const onSelect = jest.fn(), text = rootNavigationCopy[language];
    render(<RootTabBar language={language} tab={tab} onSelectTab={onSelect} />);
    for (const item of tabs) {
      const target = screen.getByRole('tab', { name: text.tabs[item] });
      expect(target.props.accessibilityState).toMatchObject({ selected: item === tab });
      expect(target.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
      expect(StyleSheet.flatten(target.props.style).minHeight).toBeGreaterThanOrEqual(56);
      fireEvent.press(target);
    }
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls.flat()).not.toContain(tab);
  });
it('root tabs wrap rather than shrink/truncate long Swedish text', () => {
  jest.spyOn(Native.Dimensions, 'get').mockReturnValue({ width: 320, height: 600, scale: 2, fontScale: 2.5 });
  render(<RootTabBar language="sv" tab="settings" onSelectTab={jest.fn()} />);
  // The group deliberately isn't one accessible element: each tab is reachable.
  const group = screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
  expect(StyleSheet.flatten(group.props.style)).toMatchObject({ flexDirection: 'column' });
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true);
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.adjustsFontSizeToFit).not.toBe(true);
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
  }
  const target = screen.getByRole('tab', { name: rootNavigationCopy.sv.tabs.settings });
  fireEvent(target, 'focus'); expect(target).toHaveStyle({ borderColor: colors.ink });
});
it('short landscape keeps a separate scrollable navigation area and space for page content', () => {
  jest.spyOn(Native.Dimensions, 'get').mockReturnValue({width:568,height:320,scale:2,fontScale:3});
  render(<RootTabBar language="sv" tab="settings" onSelectTab={jest.fn()} />);
  const scroll = screen.UNSAFE_getByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.style).maxHeight).toBeLessThan(160);
  expect(scroll.props.horizontal).not.toBe(true);
  expect(screen.getAllByRole('tab')).toHaveLength(3);
});
it('tab bar is outside scrolling content and owns the bottom safe area', () => {
  render(<AuthenticatedShell language="en" tab="home" onSelectTab={jest.fn()}>
    <HomeScreen language="en" onOpenStories={jest.fn()} onCreateStory={jest.fn()} />
  </AuthenticatedShell>);
  let ancestor = screen.UNSAFE_getByType(RootTabBar).parent;
  while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
  const edges = screen.UNSAFE_getAllByType(SafeAreaView).map(node => node.props.edges);
  expect(edges).toContainEqual(['top', 'left', 'right']);
  expect(edges).toContainEqual(['bottom', 'left', 'right']);
});
it('ordinary Screen defaults preserve entrance safe areas and centered layout', () => {
  render(<Screen><Text>Entrance</Text></Screen>);
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
});
it.each(languages.flatMap(language => (['home', 'settings'] as const).map(kind => ({language, kind}))))(
  'root $kind preserves scalable text and large controls in $language', ({language, kind}) => {
    render(kind === 'home'
      ? <HomeScreen language={language} onOpenStories={jest.fn()} onCreateStory={jest.fn()} />
      : <SettingsScreen language={language} onSelectLanguage={jest.fn()} onReplayIntroduction={jest.fn()} onSignOut={jest.fn()} />);
    for (const node of screen.UNSAFE_getAllByType(Text)) {
      expect(node.props.allowFontScaling).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined(); expect(node.props.adjustsFontSizeToFit).not.toBe(true);
      expect(StyleSheet.flatten(node.props.style)?.height).toBeUndefined();
    }
    for (const target of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('radio')]) {
      expect(StyleSheet.flatten(target.props.style).minHeight).toBeGreaterThanOrEqual(56);
    }
  });
it.each(languages)('root My Stories keeps real cards but moves account/signout to Settings: %s', language => {
  const text = storiesCopy[language], open = jest.fn();
  render(<MyStoriesScreen root language={language} user={{ id:'account-a', email:'fictional@example.test' }}
    state={{ status:'ready', projects:[{id:'10000000-0000-4000-8000-000000000001',title:'A fictional title',
      description:null,language:'sv',status:'unexpected-status',created_at:'2026-10-20T10:00:00Z',updated_at:'2026-10-20T10:00:00Z'}] }}
    onRefresh={jest.fn()} onCreateStory={jest.fn()} onOpenStory={open} onSignOut={jest.fn()} />);
  expect(screen.queryByText('fictional@example.test')).toBeNull();
  expect(screen.queryByRole('button', {name:text.signOut})).toBeNull();
  expect(screen.getByText('A fictional title')).toBeOnTheScreen();
  expect(screen.getByText(text.language + ': ' + text.swedish)).toBeOnTheScreen();
  expect(screen.getByText(text.status + ': ' + text.otherStatus)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', {name:text.openStory + ': A fictional title'}));
  expect(open).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001');
});
it('LargeButton can provide context to VoiceOver without repeating long titles visually', () => {
  const press = jest.fn();
  render(<LargeButton label="Open Story" accessibilityLabel="Open story: Fictional title" language="en" onPress={press} />);
  expect(screen.getByText('Open Story')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', {name:'Open story: Fictional title'}));
  expect(press).toHaveBeenCalledTimes(1);
});

describe('root heading focus', () => {
  let frame: FrameRequestCallback;
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 7; });
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });
  const layout = () => fireEvent(screen.getByRole('header'), 'layout', {nativeEvent:{layout:{x:0,y:0,width:300,height:80}}});
  it('focuses once after layout, without refocusing when language changes', async () => {
    jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(true);
    const view = render(<RootScreenHeading language="en" title="Home" />);
    await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    layout(); act(() => frame(0));
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    view.rerender(<RootScreenHeading language="sv" title="Hem" />); layout();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
  it('cancels stale focus on unmount', async () => {
    jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled').mockResolvedValue(true);
    const view = render(<RootScreenHeading language="en" title="Home" />); layout(); await act(async () => {});
    view.unmount(); expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    act(() => frame(0)); expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
  });
  it.each(['disabled','rejected','throws'] as const)('keeps navigation operable when native focus query is %s', async mode => {
    const query = jest.spyOn(AccessibilityInfo,'isScreenReaderEnabled');
    if (mode === 'disabled') query.mockResolvedValue(false);
    else if (mode === 'rejected') query.mockRejectedValue(new Error('Synthetic unavailable'));
    else query.mockImplementation(() => { throw new Error('Synthetic unavailable'); });
    render(<RootScreenHeading language="sv" title="Hem" />); layout(); await act(async () => {});
    expect(requestAnimationFrame).not.toHaveBeenCalled(); expect(screen.getByRole('header')).toBeOnTheScreen();
  });
});
