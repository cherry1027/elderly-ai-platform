import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useApiBackoff } from '../src/api/ApiBackoff';
import type { StoryProject } from '../src/api/story-projects';
import { accessibilityLanguages, type Language } from '../src/i18n';
import { rootNavigationCopy } from '../src/root-navigation-copy';
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
function setup(language: Language, state: MyStoriesState, root = true) {
  const actions = { onRefresh: jest.fn(), onCreateStory: jest.fn(), onOpenStory: jest.fn(), onSignOut: jest.fn() };
  const view = render(<MyStoriesScreen language={language} user={user} state={state} root={root} {...actions} />);
  return { ...actions, view };
}
beforeEach(() => jest.mocked(useApiBackoff).mockReturnValue({ waiting: false } as ReturnType<typeof useApiBackoff>));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(languages)('root %s list shows only actual titles/metadata and a count of shown records', language => {
  const projects = [project('english', 'A summer by the sea'), project('swedish', 'Sommaren vid havet', 'sv')];
  const snapshot = JSON.stringify(projects), text = storiesCopy[language];
  setup(language, { status: 'ready', projects });
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.rootIntroduction)).toBeOnTheScreen();
  expect(screen.getByText(text.rootCount(2))).toBeOnTheScreen();
  expect(screen.queryByText(text.count(2))).toBeNull();
  expect(screen.getByRole('header', { name: projects[0].title }).props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByRole('header', { name: projects[1].title }).props.accessibilityLanguage).toBe('sv-SE');
  expect(screen.getByText(`${text.language}: ${text.english}`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.language}: ${text.swedish}`)).toBeOnTheScreen();
  expect(screen.getAllByText(`${text.status}: ${text.draft}`)).toHaveLength(2);
  expect(screen.queryByText(user.email)).toBeNull();
  expect(screen.queryByRole('button', { name: text.signOut })).toBeNull();
  expect(JSON.stringify(projects)).toBe(snapshot);
});
it.each(languages)('root %s count uses singular wording for one shown story', language => {
  setup(language, { status: 'ready', projects: [project('one', 'One saved memory')] });
  expect(screen.getByText(language === 'en' ? '1 story shown.' : '1 berättelse visas.')).toBeOnTheScreen();
});
it.each(languages)('root %s count does not imply a complete total beyond the existing fifty-row boundary', language => {
  const projects = Array.from({ length: 52 }, (_, index) => project(`story-${index}`, `Saved story ${index}`));
  setup(language, { status: 'ready', projects });
  expect(screen.getByText(storiesCopy[language].rootCount(50))).toBeOnTheScreen();
  expect(screen.queryByText(storiesCopy[language].rootCount(52))).toBeNull();
  expect(screen.getByRole('header', { name: 'Saved story 49' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Saved story 50' })).toBeNull();
});
it.each(languages)('root %s Open action retains its story identity without making a request', language => {
  const saved = project('owned-story-id', 'A meaningful title'), text = storiesCopy[language];
  const actions = setup(language, { status: 'ready', projects: [saved] });
  const open = screen.getByRole('button', { name: `${text.openStory}: ${saved.title}` });
  expect(open).toHaveTextContent(rootNavigationCopy[language].openStory);
  expect(open).toHaveStyle({ minHeight: 56 });
  expect(open.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
  fireEvent.press(open);
  expect(actions.onOpenStory).toHaveBeenCalledTimes(1);
  expect(actions.onOpenStory).toHaveBeenCalledWith(saved.id);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(actions.onCreateStory).not.toHaveBeenCalled();
});
it.each(languages)('root %s Create stays primary and Refresh is a quieter explicit action', language => {
  const text = storiesCopy[language], actions = setup(language, { status: 'ready', projects: [] });
  const create = screen.getByRole('button', { name: text.createStory });
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(create).toHaveStyle({ backgroundColor: colors.forest, minHeight: 56 });
  expect(refresh).toHaveStyle({ backgroundColor: 'transparent', minHeight: 56 });
  expect(screen.getByText(text.refresh)).toHaveStyle({ textDecorationLine: 'underline' });
  fireEvent(refresh, 'focus'); expect(refresh).toHaveStyle({ borderColor: colors.ink });
  fireEvent.press(refresh); fireEvent.press(create);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  expect(actions.onCreateStory).toHaveBeenCalledTimes(1);
  expect(actions.onSignOut).not.toHaveBeenCalled();
});
it.each(languages)('root %s empty state never invents saved rows or an Open action', language => {
  setup(language, { status: 'ready', projects: [] });
  expect(screen.getByText(storiesCopy[language].empty)).toBeOnTheScreen();
  expect(screen.queryByText(storiesCopy[language].rootCount(0))).toBeNull();
  expect(screen.queryByRole('button', { name: /Open story:|Öppna berättelse:/ })).toBeNull();
});
it.each(languages)('root %s loading state disables Refresh without blocking Create navigation', language => {
  const text = storiesCopy[language], actions = setup(language, { status: 'loading' });
  expect(screen.getByText(text.loading).props.accessibilityLiveRegion).toBe('polite');
  const refresh = screen.getByRole('button', { name: text.refreshing });
  expect(refresh).toBeDisabled();
  expect(refresh.props.accessibilityState.busy).toBe(true);
  fireEvent.press(refresh); expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: text.createStory })).toBeEnabled();
});
it.each(languages.flatMap(language => (['network', 'unavailable', 'configuration', 'authentication'] as const)
  .map(error => ({ language, error }))))('root $language $error remains readable and preserves retry admission', ({ language, error }) => {
  const text = storiesCopy[language], actions = setup(language, { status: 'error', error });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(text.errors[error]);
  expect(alert.props.accessibilityLanguage).toBe(accessibilityLanguages[language]);
  expect(alert.props.accessibilityLiveRegion).toBe('assertive');
  const refresh = screen.getByRole('button', { name: text.refresh });
  if (error === 'authentication') {
    expect(refresh).toBeDisabled();
    expect(screen.getByRole('button', { name: text.createStory })).toBeDisabled();
    fireEvent.press(refresh); expect(actions.onRefresh).not.toHaveBeenCalled();
  } else {
    expect(refresh).toBeEnabled(); fireEvent.press(refresh);
    expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  }
});
it.each(languages)('root %s waiting disables Refresh and does not replay it through presentation changes', language => {
  jest.mocked(useApiBackoff).mockReturnValue({ waiting: true } as ReturnType<typeof useApiBackoff>);
  const text = storiesCopy[language], actions = setup(language, { status: 'ready', projects: [] });
  const refresh = screen.getByRole('button', { name: text.refresh });
  expect(refresh).toBeDisabled(); fireEvent.press(refresh);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  jest.mocked(useApiBackoff).mockReturnValue({ waiting: false } as ReturnType<typeof useApiBackoff>);
  actions.view.rerender(<MyStoriesScreen language={language} user={user} root state={{ status: 'ready', projects: [] }}
    onRefresh={actions.onRefresh} onCreateStory={actions.onCreateStory} onOpenStory={actions.onOpenStory} onSignOut={actions.onSignOut} />);
  expect(actions.onRefresh).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: text.refresh }));
  expect(actions.onRefresh).toHaveBeenCalledTimes(1);
});
it.each(languages)('root %s cards wrap long titles and metadata while keeping full-size targets', language => {
  const title = language === 'sv' ? 'Mina minnen från somrarna i den svenska skärgården med familjen och våra vänner'
    : 'My memories of summers with my family and friends by the sea';
  setup(language, { status: 'ready', projects: [project('long', title, language, 'unknown-private-status')] });
  expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  expect(screen.getByText(`${storiesCopy[language].status}: ${storiesCopy[language].otherStatus}`)).toBeOnTheScreen();
  expect(screen.queryByText(/unknown-private-status/)).toBeNull();
  for (const button of screen.getAllByRole('button')) {
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(button.props.style).height).toBeUndefined();
  }
  for (const text of screen.UNSAFE_getAllByType(Text)) {
    expect(text.props.allowFontScaling).toBe(true);
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    expect(text.props.adjustsFontSizeToFit).not.toBe(true);
  }
  const metadata = screen.UNSAFE_getAllByType(View).find(node => StyleSheet.flatten(node.props.style)?.flexWrap === 'wrap');
  expect(metadata).toBeDefined();
});
it.each(languages)('default %s sample/list presentation retains previous count, account and Sign Out', language => {
  const text = storiesCopy[language];
  setup(language, { status: 'ready', projects: [project('sample', 'Fictional sample')] }, false);
  expect(screen.getByText(user.email)).toBeOnTheScreen();
  expect(screen.getByText(text.count(1))).toBeOnTheScreen();
  expect(screen.queryByText(text.rootCount(1))).toBeNull();
  expect(screen.getByRole('button', { name: text.signOut })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.refresh })).toHaveStyle({ backgroundColor: colors.paper, borderColor: colors.forest });
});