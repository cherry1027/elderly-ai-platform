import { getComponent } from './component-probe';
import { nativeNodes, nativeNode } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import type { Language } from '../src/i18n';
import { MyStoriesScreen, type MyStoriesState } from '../src/screens/MyStoriesScreen';
import { storiesCopy } from '../src/stories-copy';
import { colors } from '../src/theme';

const user = { id: 'synthetic-user-a', email: 'person@example.invalid' };
function project(id = 'synthetic-project-a', title = 'A childhood memory', language: 'en' | 'sv' = 'en', status = 'draft'): StoryProject {
  return { id, title, description: null, language, status,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
async function setup(state: MyStoriesState, language: Language = 'en') {
  const callbacks = { onRefresh: jest.fn(), onCreateStory: jest.fn(), onSignOut: jest.fn() };
  const view = await render(<MyStoriesScreen {...callbacks} language={language} user={user} state={state} />);
  return { ...callbacks, view };
}

describe('native read-only My Stories presentation', () => {
  it.each<Language>(['en', 'sv'])('shows titles, language and supported draft status in %s', async (language) => {
    const text = storiesCopy[language];
    await setup({ status: 'ready', projects: [project(), project('synthetic-project-b', 'Ett barndomsminne', 'sv')] }, language);
    expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
    expect(screen.getByText(user.email)).toBeOnTheScreen();
    expect(screen.getByText('A childhood memory')).toBeOnTheScreen();
    expect(screen.getByText('Ett barndomsminne')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'A childhood memory' }).props.accessibilityLanguage).toBe('en-GB');
    expect(screen.getByRole('header', { name: 'Ett barndomsminne' }).props.accessibilityLanguage).toBe('sv-SE');
    expect(screen.getByText(`${text.language}: ${text.english}`)).toBeOnTheScreen();
    expect(screen.getByText(`${text.language}: ${text.swedish}`)).toBeOnTheScreen();
    expect(screen.getAllByText(`${text.status}: ${text.draft}`)).toHaveLength(2);
    expect(screen.getByText(text.count(2))).toBeOnTheScreen();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('shows a calm empty state in %s', async (language) => {
    await setup({ status: 'ready', projects: [] }, language);
    expect(screen.getByText(storiesCopy[language].empty)).toBeOnTheScreen();
    expect(screen.queryByText(storiesCopy[language].count(0))).toBeNull();
    expect(screen.getByRole('button', { name: storiesCopy[language].refresh })).toBeEnabled();
  });

  it.each<Language>(['en', 'sv'])('disables Refresh while loading but always permits Sign Out in %s', async (language) => {
    const { onRefresh, onSignOut } = await setup({ status: 'loading' }, language);
    const text = storiesCopy[language];
    expect(screen.getByText(text.loading).props.accessibilityLiveRegion).toBe('polite');
    const refresh = screen.getByRole('button', { name: text.refreshing });
    expect(refresh).toBeDisabled(); expect(refresh.props.accessibilityState.busy).toBe(true);
    await fireEvent.press(refresh); expect(onRefresh).not.toHaveBeenCalled();
    const signOut = screen.getByRole('button', { name: text.signOut });
    expect(signOut).toBeEnabled(); await fireEvent.press(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(storiesCopy.en.errors) as StoryProjectsErrorKind[])('shows safe localized guidance and keeps Sign Out available for %s', async (error) => {
    const { onSignOut } = await setup({ status: 'error', error }, 'sv');
    expect(screen.getByRole('alert')).toHaveTextContent(storiesCopy.sv.errors[error]);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.sv.signOut }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('A childhood memory')).toBeNull();
  });

  it('offers working refresh after a network error and prevents refresh of an invalid session', async () => {
    const callbacks = { onRefresh: jest.fn(), onCreateStory: jest.fn(), onSignOut: jest.fn() };
    const view = await render(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'error', error: 'network' }} />);
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
    await view.rerender(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'error', error: 'authentication' }} />);
    const refresh = screen.getByRole('button', { name: storiesCopy.en.refresh });
    expect(refresh).toBeDisabled(); await fireEvent.press(refresh);
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders arbitrary project status as a generic label without echoing it', async () => {
    await setup({ status: 'ready', projects: [project('synthetic-a', 'Known title', 'en', 'private-status-sentinel')] });
    expect(screen.getByText(`${storiesCopy.en.status}: ${storiesCopy.en.otherStatus}`)).toBeOnTheScreen();
    expect(screen.queryByText(/private-status-sentinel/)).toBeNull();
  });

  it('does not mistake conversation-session statuses for documented project statuses', async () => {
    await setup({ status: 'ready', projects: [project('synthetic-a', 'Known title', 'en', 'active')] });
    expect(screen.getByText(`${storiesCopy.en.status}: ${storiesCopy.en.otherStatus}`)).toBeOnTheScreen();
  });

  it.each<Language>(['en', 'sv'])('uses a localized, correctly pronounced fallback for a blank title in %s', async (language) => {
    await setup({ status: 'ready', projects: [project('blank-title', '   ', 'en')] }, language);
    const title = screen.getByRole('header', { name: storiesCopy[language].untitled });
    expect(title).toBeOnTheScreen();
    expect(title.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
  });

  it('renders no more than the first 50 projects, in supplied order', async () => {
    const projects = Array.from({ length: 52 }, (_, index) => project(`synthetic-${index}`, `Story ${index}`));
    await setup({ status: 'ready', projects });
    expect(screen.getByText('Story 0')).toBeOnTheScreen();
    expect(screen.getByText('Story 49')).toBeOnTheScreen();
    expect(screen.queryByText('Story 50')).toBeNull(); expect(screen.queryByText('Story 51')).toBeNull();
    expect(screen.getByText(storiesCopy.en.count(50))).toBeOnTheScreen();
  });

  it('removes old rows immediately when the parent starts reloading or replaces the account', async () => {
    const callbacks = { onRefresh: jest.fn(), onCreateStory: jest.fn(), onSignOut: jest.fn() };
    const view = await render(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'ready', projects: [project()] }} />);
    expect(screen.getByText('A childhood memory')).toBeOnTheScreen();
    await view.rerender(<MyStoriesScreen {...callbacks} language="en" user={{ id: 'synthetic-b', email: 'other@example.invalid' }} state={{ status: 'loading' }} />);
    expect(screen.queryByText('A childhood memory')).toBeNull(); expect(screen.queryByText(user.email)).toBeNull();
    expect(screen.getByText('other@example.invalid')).toBeOnTheScreen();
    await view.rerender(<MyStoriesScreen {...callbacks} language="en" user={{ id: 'synthetic-b', email: 'other@example.invalid' }} state={{ status: 'ready', projects: [project('synthetic-b', 'Another account story')] }} />);
    expect(screen.getByText('Another account story')).toBeOnTheScreen(); expect(screen.queryByText('A childhood memory')).toBeNull();
  });

  it('removes prior results when an error arrives', async () => {
    const { view } = await setup({ status: 'ready', projects: [project()] });
    await view.rerender(<MyStoriesScreen language="en" user={user} state={{ status: 'error', error: 'network' }} onRefresh={jest.fn()} onCreateStory={jest.fn()} onSignOut={jest.fn()} />);
    expect(screen.queryByText('A childhood memory')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(storiesCopy.en.errors.network);
  });

  it('offers intentional story creation without editing, detail-opening, recording or guest actions', async () => {
    await setup({ status: 'ready', projects: [project()] });
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: storiesCopy.en.createStory })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /edit|open|record|guest/i })).toBeNull();
    expect(screen.queryByText(/AI|microphone|recording/i)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('offers an accessible explicit Create My Story action in %s without making a request', async language => {
    const { onCreateStory, onRefresh, onSignOut } = await setup({ status: 'ready', projects: [] }, language);
    const create = screen.getByRole('button', { name: storiesCopy[language].createStory });
    expect(create.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
    expect(create).toBeEnabled(); await fireEvent.press(create);
    expect(onCreateStory).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<MyStoriesState>([
    { status: 'loading' }, { status: 'error', error: 'configuration' }, { status: 'error', error: 'network' },
  ])('keeps creation available while the story list cannot load (%#)', async state => {
    const { onCreateStory } = await setup(state);
    const create = screen.getByRole('button', { name: storiesCopy.en.createStory });
    expect(create).toBeEnabled(); await fireEvent.press(create);
    expect(onCreateStory).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('blocks creation after authentication failure while preserving Sign Out in %s', async language => {
    const { onCreateStory, onSignOut } = await setup({ status: 'error', error: 'authentication' }, language);
    const create = screen.getByRole('button', { name: storiesCopy[language].createStory });
    expect(create).toBeDisabled();
    expect(create.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(create); expect(onCreateStory).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy[language].signOut }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each<Language>(['en', 'sv'])('keeps text scalable, targets large and layout scrollable with safe areas in %s', async (language) => {
    await setup({ status: 'ready', projects: [project('long-title', 'A long memory title that can wrap across the available width without truncation')] }, language);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of nativeNodes('text')) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined(); expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.maxHeight).toBeUndefined();
    }
    expect(getComponent(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(nativeNode('scroll').props.scrollEnabled).not.toBe(false);
    const refresh = screen.getByRole('button', { name: storiesCopy[language].refresh });
    await fireEvent(refresh, 'focus'); expect(refresh).toHaveStyle({ borderColor: colors.ink });
    await fireEvent(refresh, 'blur'); expect(refresh).toHaveStyle({ borderColor: colors.forest });
    const create = screen.getByRole('button', { name: storiesCopy[language].createStory });
    await fireEvent(create, 'focus'); expect(create).toHaveStyle({ borderColor: colors.ink });
    await fireEvent(create, 'blur'); expect(create).toHaveStyle({ borderColor: colors.forest });
  });
});
