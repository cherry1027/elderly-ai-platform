import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Text } from 'react-native';
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
function setup(state: MyStoriesState, language: Language = 'en') {
  const callbacks = { onRefresh: jest.fn(), onSignOut: jest.fn() };
  const view = render(<MyStoriesScreen {...callbacks} language={language} user={user} state={state} />);
  return { ...callbacks, view };
}

describe('native read-only My Stories presentation', () => {
  it.each<Language>(['en', 'sv'])('shows titles, language and supported draft status in %s', (language) => {
    const text = storiesCopy[language];
    setup({ status: 'ready', projects: [project(), project('synthetic-project-b', 'Ett barndomsminne', 'sv')] }, language);
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

  it.each<Language>(['en', 'sv'])('shows a calm empty state in %s', (language) => {
    setup({ status: 'ready', projects: [] }, language);
    expect(screen.getByText(storiesCopy[language].empty)).toBeOnTheScreen();
    expect(screen.queryByText(storiesCopy[language].count(0))).toBeNull();
    expect(screen.getByRole('button', { name: storiesCopy[language].refresh })).toBeEnabled();
  });

  it.each<Language>(['en', 'sv'])('disables Refresh while loading but always permits Sign Out in %s', (language) => {
    const { onRefresh, onSignOut } = setup({ status: 'loading' }, language);
    const text = storiesCopy[language];
    expect(screen.getByText(text.loading).props.accessibilityLiveRegion).toBe('polite');
    const refresh = screen.getByRole('button', { name: text.refreshing });
    expect(refresh).toBeDisabled(); expect(refresh.props.accessibilityState.busy).toBe(true);
    fireEvent.press(refresh); expect(onRefresh).not.toHaveBeenCalled();
    const signOut = screen.getByRole('button', { name: text.signOut });
    expect(signOut).toBeEnabled(); fireEvent.press(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(storiesCopy.en.errors) as StoryProjectsErrorKind[])('shows safe localized guidance and keeps Sign Out available for %s', (error) => {
    const { onSignOut } = setup({ status: 'error', error }, 'sv');
    expect(screen.getByRole('alert')).toHaveTextContent(storiesCopy.sv.errors[error]);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.sv.signOut }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('A childhood memory')).toBeNull();
  });

  it('offers working refresh after a network error and prevents refresh of an invalid session', () => {
    const callbacks = { onRefresh: jest.fn(), onSignOut: jest.fn() };
    const view = render(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'error', error: 'network' }} />);
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
    view.rerender(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'error', error: 'authentication' }} />);
    const refresh = screen.getByRole('button', { name: storiesCopy.en.refresh });
    expect(refresh).toBeDisabled(); fireEvent.press(refresh);
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders arbitrary project status as a generic label without echoing it', () => {
    setup({ status: 'ready', projects: [project('synthetic-a', 'Known title', 'en', 'private-status-sentinel')] });
    expect(screen.getByText(`${storiesCopy.en.status}: ${storiesCopy.en.otherStatus}`)).toBeOnTheScreen();
    expect(screen.queryByText(/private-status-sentinel/)).toBeNull();
  });

  it('does not mistake conversation-session statuses for documented project statuses', () => {
    setup({ status: 'ready', projects: [project('synthetic-a', 'Known title', 'en', 'active')] });
    expect(screen.getByText(`${storiesCopy.en.status}: ${storiesCopy.en.otherStatus}`)).toBeOnTheScreen();
  });

  it.each<Language>(['en', 'sv'])('uses a localized, correctly pronounced fallback for a blank title in %s', (language) => {
    setup({ status: 'ready', projects: [project('blank-title', '   ', 'en')] }, language);
    const title = screen.getByRole('header', { name: storiesCopy[language].untitled });
    expect(title).toBeOnTheScreen();
    expect(title.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
  });

  it('renders no more than the first 50 projects, in supplied order', () => {
    const projects = Array.from({ length: 52 }, (_, index) => project(`synthetic-${index}`, `Story ${index}`));
    setup({ status: 'ready', projects });
    expect(screen.getByText('Story 0')).toBeOnTheScreen();
    expect(screen.getByText('Story 49')).toBeOnTheScreen();
    expect(screen.queryByText('Story 50')).toBeNull(); expect(screen.queryByText('Story 51')).toBeNull();
    expect(screen.getByText(storiesCopy.en.count(50))).toBeOnTheScreen();
  });

  it('removes old rows immediately when the parent starts reloading or replaces the account', () => {
    const callbacks = { onRefresh: jest.fn(), onSignOut: jest.fn() };
    const view = render(<MyStoriesScreen {...callbacks} language="en" user={user} state={{ status: 'ready', projects: [project()] }} />);
    expect(screen.getByText('A childhood memory')).toBeOnTheScreen();
    view.rerender(<MyStoriesScreen {...callbacks} language="en" user={{ id: 'synthetic-b', email: 'other@example.invalid' }} state={{ status: 'loading' }} />);
    expect(screen.queryByText('A childhood memory')).toBeNull(); expect(screen.queryByText(user.email)).toBeNull();
    expect(screen.getByText('other@example.invalid')).toBeOnTheScreen();
    view.rerender(<MyStoriesScreen {...callbacks} language="en" user={{ id: 'synthetic-b', email: 'other@example.invalid' }} state={{ status: 'ready', projects: [project('synthetic-b', 'Another account story')] }} />);
    expect(screen.getByText('Another account story')).toBeOnTheScreen(); expect(screen.queryByText('A childhood memory')).toBeNull();
  });

  it('removes prior results when an error arrives', () => {
    const { view } = setup({ status: 'ready', projects: [project()] });
    view.rerender(<MyStoriesScreen language="en" user={user} state={{ status: 'error', error: 'network' }} onRefresh={jest.fn()} onSignOut={jest.fn()} />);
    expect(screen.queryByText('A childhood memory')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(storiesCopy.en.errors.network);
  });

  it('has no creation, editing, detail-opening, recording or guest actions', () => {
    setup({ status: 'ready', projects: [project()] });
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /create|edit|open|record|guest/i })).toBeNull();
    expect(screen.queryByText(/AI|microphone|recording/i)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<Language>(['en', 'sv'])('keeps text scalable, targets large and layout scrollable with safe areas in %s', (language) => {
    setup({ status: 'ready', projects: [project('long-title', 'A long memory title that can wrap across the available width without truncation')] }, language);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
    for (const text of screen.UNSAFE_getAllByType(Text)) {
      expect(text.props.allowFontScaling).toBe(true);
      expect(text.props.numberOfLines).toBeUndefined(); expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(text.props.style)?.maxHeight).toBeUndefined();
    }
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom', 'left', 'right']);
    expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).not.toBe(false);
    const refresh = screen.getByRole('button', { name: storiesCopy[language].refresh });
    fireEvent(refresh, 'focus'); expect(refresh).toHaveStyle({ borderColor: colors.ink });
    fireEvent(refresh, 'blur'); expect(refresh).toHaveStyle({ borderColor: colors.forest });
  });
});
