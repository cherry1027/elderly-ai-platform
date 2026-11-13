import { nativeNodes, nativeText } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Native from 'react-native';
import { useApiBackoff } from '../src/api/ApiBackoff';
import type { StoryProject } from '../src/api/story-projects';
import { accessibilityLanguages, type Language } from '../src/i18n';
import { MyStoriesScreen, type MyStoriesState } from '../src/screens/MyStoriesScreen';
import { storiesCopy } from '../src/stories-copy';
import { colors } from '../src/theme';

jest.mock('../src/api/ApiBackoff', () => ({
  useApiBackoff: jest.fn(() => ({ waiting: false })),
  ApiBackoffBanner: () => null,
}));
const languages: Language[] = ['en', 'sv'];
const user = { id: 'fictional-owner', email: 'fictional@example.invalid' };
function project(id: string, title: string, language: 'en' | 'sv' = 'en', status = 'draft'): StoryProject {
  return { id, title, language, status, description: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
async function setup(language: Language, state: MyStoriesState, root = true) {
  const actions = { onRefresh: jest.fn(), onCreateStory: jest.fn(), onOpenStory: jest.fn(), onSignOut: jest.fn() };
  const view = await render(<MyStoriesScreen language={language} user={user} state={state} root={root} {...actions} />);
  return { ...actions, view };
}
beforeEach(() => jest.mocked(useApiBackoff).mockReturnValue({ waiting: false } as ReturnType<typeof useApiBackoff>));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(languages)('root %s list shows actual titles, quiet language and no administrative status', async language => {
  const projects = [project('english', 'A summer by the sea'), project('swedish', 'Sommaren vid havet', 'sv')];
  const snapshot = JSON.stringify(projects), text = storiesCopy[language];
  await setup(language, { status: 'ready', projects });
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.rootIntroduction)).toBeOnTheScreen();
  expect(screen.queryByText(text.rootCount(2))).toBeNull();
  expect(screen.queryByText(text.listLimit)).toBeNull();
  expect(screen.queryByText(text.count(2))).toBeNull();
  expect(screen.getByText(projects[0].title).props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(projects[1].title).props.accessibilityLanguage).toBe('sv-SE');
  expect(screen.getByText(text.english)).toBeOnTheScreen();
  expect(screen.getByText(text.swedish)).toBeOnTheScreen();
  expect(screen.queryByText(`${text.status}: ${text.draft}`)).toBeNull();
  expect(screen.queryByText(user.email)).toBeNull();
  expect(screen.queryByRole('button', { name: text.signOut })).toBeNull();
  expect(JSON.stringify(projects)).toBe(snapshot);
});
it.each(languages)('root %s omits an unnecessary count for one story', async language => {
  await setup(language, { status: 'ready', projects: [project('one', 'One saved memory')] });
  expect(screen.queryByText(storiesCopy[language].rootCount(1))).toBeNull();
  expect(screen.queryByText(storiesCopy[language].listLimit)).toBeNull();
  expect(screen.getByText('One saved memory')).toBeOnTheScreen();
});
it.each(languages)('root %s count does not imply a complete total beyond the existing fifty-row boundary', async language => {
  const projects = Array.from({ length: 52 }, (_, index) => project(`story-${index}`, `Saved story ${index}`));
  await setup(language, { status: 'ready', projects });
  expect(screen.getByText(storiesCopy[language].listLimit)).toBeOnTheScreen();
  expect(screen.queryByText(storiesCopy[language].rootCount(52))).toBeNull();
  expect(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: Saved story 49` })).toBeOnTheScreen();
  expect(screen.queryByText('Saved story 50')).toBeNull();
});
it.each(languages)('root %s Open action retains its story identity without making a request', async language => {
  const saved = project('owned-story-id', 'A meaningful title'), text = storiesCopy[language];
  const actions = await setup(language, { status: 'ready', projects: [saved] });
  const open = screen.getByRole('button', { name: `${text.openStory}: ${saved.title}` });
  expect(open).toHaveTextContent(`${saved.title}${text.english}›`);
  expect(screen.queryByText(text.openStory)).toBeNull();
  expect(screen.getAllByRole('button').filter(button => button.props.accessibilityLabel === `${text.openStory}: ${saved.title}`)).toHaveLength(1);
  expect(open).toHaveStyle({ minHeight: 56 });
  expect(open.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
  expect(open.props.accessibilityHint).toBe(`${text.language}: ${text.english}`);
  await fireEvent.press(open);
  expect(actions.onOpenStory).toHaveBeenCalledTimes(1);
  expect(actions.onOpenStory).toHaveBeenCalledWith(saved.id);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(actions.onCreateStory).not.toHaveBeenCalled();
});
it.each(languages)('root %s empty state offers a first-story action and keeps explicit Refresh in options', async language => {
  const text = storiesCopy[language], actions = await setup(language, { status: 'ready', projects: [] });
  const create = screen.getByRole('button', { name: text.firstStory });
  expect(screen.queryByRole('button', { name: text.createStory })).toBeNull();
  expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.listOptions }));
  expect(actions.onRefresh).not.toHaveBeenCalled();
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(create).toHaveStyle({ backgroundColor: colors.forest, minHeight: 56 });
  expect(refresh).toHaveStyle({ backgroundColor: 'transparent', minHeight: 56 });
  expect(screen.getByText(text.refresh)).toHaveStyle({ textDecorationLine: 'underline' });
  await fireEvent(refresh, 'focus'); expect(refresh).toHaveStyle({ borderColor: colors.ink });
  await fireEvent.press(refresh); await fireEvent.press(create);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  expect(actions.onCreateStory).toHaveBeenCalledTimes(1);
  expect(actions.onSignOut).not.toHaveBeenCalled();
});
it.each(languages)('root %s empty state never invents saved rows or an Open action', async language => {
  await setup(language, { status: 'ready', projects: [] });
  expect(screen.getByText(storiesCopy[language].empty)).toBeOnTheScreen();
  expect(screen.queryByText(storiesCopy[language].rootCount(0))).toBeNull();
  expect(screen.queryByRole('button', { name: /Open story:|Öppna berättelse:/ })).toBeNull();
});
it.each(languages)('root %s loading state disables Refresh without blocking Create navigation', async language => {
  const text = storiesCopy[language], actions = await setup(language, { status: 'loading' });
  expect(screen.getByText(text.loading).props.accessibilityLiveRegion).toBe('polite');
  expect(screen.getAllByText(text.loading)).toHaveLength(1);
  expect(screen.queryByText(text.refreshing)).toBeNull();
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(refresh).toBeDisabled();
  expect(refresh.props.accessibilityState.busy).toBe(true);
  await fireEvent.press(refresh); expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: text.createStory })).toBeEnabled();
});
it.each(languages.flatMap(language => (['network', 'unavailable', 'configuration', 'authentication'] as const)
  .map(error => ({ language, error }))))('root $language $error remains readable and preserves retry admission', async ({ language, error }) => {
  const text = storiesCopy[language], actions = await setup(language, { status: 'error', error });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(text.errors[error]);
  expect(alert.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
  expect(alert.props.accessibilityLiveRegion).toBe('assertive');
  const refresh = screen.getByRole('button', { name: text.refresh });
  if (error === 'authentication') {
    expect(refresh).toBeDisabled();
    expect(screen.getByRole('button', { name: text.createStory })).toBeDisabled();
    await fireEvent.press(refresh); expect(actions.onRefresh).not.toHaveBeenCalled();
  } else {
    expect(refresh).toBeEnabled(); await fireEvent.press(refresh);
    expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  }
});
it.each(languages)('root %s waiting disables Refresh and does not replay it through presentation changes', async language => {
  jest.mocked(useApiBackoff).mockReturnValue({ waiting: true } as ReturnType<typeof useApiBackoff>);
  const text = storiesCopy[language], actions = await setup(language, { status: 'ready', projects: [] });
  await fireEvent.press(screen.getByRole('button', { name: text.listOptions }));
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(refresh).toBeDisabled(); await fireEvent.press(refresh);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  jest.mocked(useApiBackoff).mockReturnValue({ waiting: false } as ReturnType<typeof useApiBackoff>);
  await actions.view.rerender(<MyStoriesScreen language={language} user={user} root state={{ status: 'ready', projects: [] }}
    onRefresh={actions.onRefresh} onCreateStory={actions.onCreateStory} onOpenStory={actions.onOpenStory} onSignOut={actions.onSignOut} />);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.refresh }));
  expect(actions.onRefresh).toHaveBeenCalledTimes(1);
});
it.each(languages)('root %s cards wrap long titles and metadata while keeping full-size targets', async language => {
  const title = language === 'sv' ? 'Mina minnen från somrarna i den svenska skärgården med familjen och våra vänner'
    : 'My memories of summers with my family and friends by the sea';
  await setup(language, { status: 'ready', projects: [project('long', title, language, 'unknown-private-status')] });
  expect(screen.getByRole('button', { name: `${storiesCopy[language].openStory}: ${title}` })).toBeOnTheScreen();
  expect(screen.queryByText(`${storiesCopy[language].status}: ${storiesCopy[language].otherStatus}`)).toBeNull();
  expect(screen.queryByText(/unknown-private-status/)).toBeNull();
  for (const button of screen.getAllByRole('button')) {
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(button.props.style).height).toBeUndefined();
  }
  for (const text of nativeNodes('text')) {
    expect(text.props.allowFontScaling).toBe(true);
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    expect(text.props.adjustsFontSizeToFit).not.toBe(true);
  }
  const metadata = nativeNodes('view').find(node => StyleSheet.flatten(node.props.style)?.flexWrap === 'wrap');
  expect(metadata).toBeDefined();
});
it.each(languages)('default %s sample/list presentation retains previous count, account and Sign Out', async language => {
  const text = storiesCopy[language];
  await setup(language, { status: 'ready', projects: [project('sample', 'Fictional sample')] }, false);
  expect(screen.getByText(user.email)).toBeOnTheScreen();
  expect(screen.getByText(text.count(1))).toBeOnTheScreen();
  expect(screen.queryByText(text.rootCount(1))).toBeNull();
  expect(screen.getByRole('button', { name: text.signOut })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.refresh })).toHaveStyle({ backgroundColor: colors.paper, borderColor: colors.forest });
});
it.each(languages)('root %s puts existing stories before the primary New story action', async language => {
  const text = storiesCopy[language], saved = project('existing', 'An existing saved story');
  const actions = await setup(language, { status: 'ready', projects: [saved] });
  const create = screen.getByRole('button', { name: text.createStory });
  expect(create).toHaveStyle({ backgroundColor: colors.forest, minHeight: 56 });
  expect(screen.queryByRole('button', { name: text.firstStory })).toBeNull();
  const labels = nativeNodes('text').map(nativeText);
  expect(labels.indexOf(saved.title)).toBeLessThan(labels.indexOf(`+ ${text.createStory}`));
  const open = screen.getByRole('button', { name: `${text.openStory}: ${saved.title}` });
  expect(open).toHaveStyle({ minHeight: 56, borderColor: colors.border });
  await fireEvent.press(open); expect(actions.onOpenStory).toHaveBeenCalledWith(saved.id);
  await fireEvent.press(create); expect(actions.onCreateStory).toHaveBeenCalledTimes(1);
  expect(actions.onRefresh).not.toHaveBeenCalled();
});

it.each(languages)('root %s whole story row is reachable with narrow large-text layout and keyboard focus', async language => {
  const dimensions = jest.spyOn(Native.Dimensions, 'get').mockReturnValue({ width: 320, height: 600, scale: 2, fontScale: 2.5 });
  try {
    const saved = project('long-accessible-row', 'A long story title that remains fully readable at larger text sizes', language);
    const actions = await setup(language, { status: 'ready', projects: [saved] });
    const row = screen.getByRole('button', { name: `${storiesCopy[language].openStory}: ${saved.title}` });
    expect(row).toHaveStyle({ minHeight: 56 });
    expect(StyleSheet.flatten(row.props.style).height).toBeUndefined();
    const title = screen.getByText(saved.title);
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.allowFontScaling).toBe(true);
    expect(title).toHaveStyle({ flexShrink: 1 });
    await fireEvent(row, 'focus'); expect(row).toHaveStyle({ borderColor: colors.ink });
    await fireEvent.press(row); expect(actions.onOpenStory).toHaveBeenCalledWith(saved.id);
    await fireEvent(row, 'blur'); expect(row).toHaveStyle({ borderColor: colors.border });
    expect(actions.onRefresh).not.toHaveBeenCalled();
  } finally { dimensions.mockRestore(); }
});


it.each(languages)('root %s refresh keeps usable stories and announces Updating only once', async language => {
  const text = storiesCopy[language], saved = project('retained', 'A saved childhood');
  const actions = await setup(language, { status: 'ready', projects: [saved] });
  await fireEvent.press(screen.getByRole('button', { name: text.listOptions }));
  await actions.view.rerender(<MyStoriesScreen language={language} user={user} root
    state={{ status: 'ready', projects: [saved], refreshing: true }}
    onRefresh={actions.onRefresh} onCreateStory={actions.onCreateStory} onOpenStory={actions.onOpenStory} onSignOut={actions.onSignOut} />);
  expect(screen.getByText(saved.title)).toBeOnTheScreen();
  expect(screen.getAllByText(text.refreshing)).toHaveLength(1);
  expect(screen.getByText(text.refreshing)).toHaveStyle({ fontSize: 17, lineHeight: 26 });
  expect(screen.getByText(text.refreshing).props.accessibilityLiveRegion).toBe('polite');
  expect(screen.queryByText(text.loading)).toBeNull();
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(refresh).toBeDisabled(); expect(refresh.props.accessibilityState.busy).toBe(true);
  await fireEvent.press(refresh); expect(actions.onRefresh).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: `${text.openStory}: ${saved.title}` }));
  expect(actions.onOpenStory).toHaveBeenCalledWith(saved.id);
});
