import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler } from 'react-native';
import { StoryPreview } from '../src/development/StoryPreview';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { createStoryCopy } from '../src/create-story-copy';
import { storiesCopy } from '../src/stories-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { copy } from '../src/i18n';
import { introCopy } from '../src/intro-copy';

jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
beforeEach(() => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => {
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
  expect(globalThis.WebSocket).not.toHaveBeenCalled(); jest.restoreAllMocks();
});
function samples() { fireEvent.press(screen.getByRole('button', { name: 'View sample stories' })); }
function changeToSwedish() {
  fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
  fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
  fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
}
it('is unavailable unless the explicit development gate is valid', () => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false); render(<StoryPreview />);
  expect(screen.queryByText(/SAMPLE STORIES/)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('labels samples, opens details and never loads real account data', () => {
  render(<StoryPreview />);
  expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText(introCopy.en.unavailable)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: introCopy.en.login })).toBeNull();
  expect(screen.queryByRole('button', { name: introCopy.en.register })).toBeNull();
  expect(screen.queryByRole('button', { name: introCopy.en.guest })).toBeNull();
  samples();
  fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  expect(screen.getByText('An invented example for testing.\nNo personal story is stored here.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: storyDetailsCopy.en.edit })).toBeOnTheScreen();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('permits editing samples but never fabricates a successful save or mutates them', () => {
  render(<StoryPreview />);
  samples();
  fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'A changed synthetic title');
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.save }));
  expect(screen.getByLabelText(storyDetailsCopy.en.titleLabel).props.value).toBe('A changed synthetic title');
  expect(screen.queryByText(storyDetailsCopy.en.saved)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.cancel }));
  expect(screen.getByRole('header', { name: 'A made-up summer memory' })).toBeOnTheScreen();
  expect(screen.queryByText('A changed synthetic title')).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('exercises the real Create form and Unicode validator without fake persistence', () => {
  render(<StoryPreview />); samples(); fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
  fireEvent.changeText(input, '\u0085'); fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
  expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.en.validation.required);
  fireEvent.changeText(input, 'Synthetic valid title'); fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
  expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.back }));
  expect(screen.queryByRole('header', { name: 'Synthetic valid title' })).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('supports Swedish samples and safely labels unknown status', () => {
  render(<StoryPreview />); changeToSwedish();
  expect(screen.getByText('EXEMPELBERÄTTELSER. Inget sparas.')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Visa exempelberättelser' }));
  fireEvent.press(screen.getByRole('button', { name: 'Öppna berättelse: Ett påhittat sommarminne' }));
  expect(screen.getByText('Status: Annan status')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.sv.edit }));
  expect(screen.getByLabelText(storyDetailsCopy.sv.titleLabel).props.value).toBe('Ett påhittat sommarminne');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('drops typed drafts on background and keeps Welcome on resume without account cleanup', () => {
  const changes = jest.spyOn(AppState, 'addEventListener');
  try {
    render(<StoryPreview />); samples(); fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Private synthetic draft');
    act(() => { changes.mock.calls[0][1]('background'); });
    expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull();
    samples();
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
    act(() => { changes.mock.calls[0][1]('background'); changes.mock.calls[0][1]('active'); });
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
    samples();
    expect(screen.getByRole('header', { name: storiesCopy.en.title })).toBeOnTheScreen();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally { changes.mockRestore(); }
});

it.each(['list', 'create', 'details', 'edit'] as const)('sample Sign Out from %s returns to Welcome and discards drafts', where => {
  render(<StoryPreview />); samples();
  if (where === 'create') {
    fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Discard this sample draft');
  } else if (where === 'details' || where === 'edit') {
    fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
    if (where === 'edit') {
      fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
      fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Discard this sample draft');
    }
  }
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByText('The sample preview is closed.')).toBeNull();
  expect(screen.queryByText('Discard this sample draft')).toBeNull();
  samples();
  expect(screen.getByText('A made-up summer memory')).toBeOnTheScreen();
  expect(screen.queryByText('Discard this sample draft')).toBeNull();
});

it('Exit Preview returns to the isolated Welcome without changing the selected language', () => {
  render(<StoryPreview />); changeToSwedish();
  fireEvent.press(screen.getByRole('button', { name: 'Visa exempelberättelser' }));
  fireEvent.press(screen.getByRole('button', { name: 'Lämna förhandsvisningen / Till Välkommen' }));
  expect(screen.getByRole('header', { name: copy.sv.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: copy.sv.changeLanguage }));
  expect(screen.getByRole('radio', { name: 'Svenska' })).toBeChecked();
  fireEvent.press(screen.getByRole('button', { name: introCopy.sv.back }));
  expect(screen.getByRole('header', { name: copy.sv.welcomeTitle })).toBeOnTheScreen();
});

it('replays all three real animated scenes and returns to the isolated Welcome', () => {
  render(<StoryPreview />);
  fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  for (let scene = 0; scene < 3; scene++) {
    expect(screen.getByRole('header', { name: introCopy.en.scenes[scene].title })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: scene === 2 ? introCopy.en.enter : introCopy.en.next }));
  }
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  fireEvent.press(screen.getByRole('button', { name: introCopy.en.skip }));
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
});

it('uses Android Back for Edit → Details → My Stories → Welcome, then leaves Back to the host', () => {
  const events = jest.spyOn(BackHandler, 'addEventListener');
  const back = () => {
    const last = events.mock.calls[events.mock.calls.length - 1][1];
    let handled: boolean | null | undefined;
    act(() => { handled = last({} as Parameters<typeof last>[0]); }); return handled;
  };
  render(<StoryPreview />); samples();
  fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Unretained sample edit');
  expect(back()).toBe(true);
  expect(screen.getByRole('button', { name: storyDetailsCopy.en.edit })).toBeOnTheScreen();
  expect(back()).toBe(true);
  expect(screen.getByRole('header', { name: storiesCopy.en.title })).toBeOnTheScreen();
  expect(back()).toBe(true);
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(back()).toBe(false);
});

it('restarts the sample workspace at Welcome without reading or overwriting real onboarding preferences', () => {
  const first = render(<StoryPreview />); changeToSwedish(); first.unmount();
  render(<StoryPreview />);
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByText('Ett påhittat sommarminne')).toBeNull();
});

it('removes every preview lifecycle and Back listener when changing screens and unmounting', () => {
  const lifecycle = jest.mocked(AppState.addEventListener);
  const back = jest.mocked(BackHandler.addEventListener);
  const view = render(<StoryPreview />); samples();
  fireEvent.press(screen.getByRole('button', { name: 'Exit Preview / Return to Welcome' }));
  view.unmount();
  for (const result of [...lifecycle.mock.results, ...back.mock.results]) {
    if (result.type === 'return') expect(result.value.remove).toHaveBeenCalledTimes(1);
  }
});
