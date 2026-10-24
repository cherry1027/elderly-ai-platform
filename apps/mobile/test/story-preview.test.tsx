import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler } from 'react-native';
import { StoryPreview } from '../src/development/StoryPreview';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { createStoryCopy } from '../src/create-story-copy';
import { storiesCopy } from '../src/stories-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
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
async function samples() { await fireEvent.press(screen.getByRole('button', { name: 'View sample stories' })); }
async function changeToSwedish() {
  await fireEvent.press(screen.getByRole('button', { name: copy.en.changeLanguage }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Svenska' }));
  await fireEvent.press(screen.getByRole('button', { name: copy.sv.continue }));
}
it('is unavailable unless the explicit development gate is valid', async () => {
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false); await render(<StoryPreview />);
  expect(screen.queryByText(/SAMPLE STORIES/)).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('labels samples, opens details and never loads real account data', async () => {
  await render(<StoryPreview />);
  expect(screen.getByText('SAMPLE STORIES. Nothing is saved.')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText(introCopy.en.unavailable)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: introCopy.en.login })).toBeNull();
  expect(screen.queryByRole('button', { name: introCopy.en.register })).toBeNull();
  expect(screen.queryByRole('button', { name: introCopy.en.guest })).toBeNull();
  await samples();
  await fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  expect(screen.getByText('An invented example for testing.\nNo personal story is stored here.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: storyDetailsCopy.en.edit })).toBeOnTheScreen();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('permits editing samples but never fabricates a successful save or mutates them', async () => {
  await render(<StoryPreview />);
  await samples();
  await fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  await fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'A changed synthetic title');
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.save }));
  expect(screen.getByLabelText(storyDetailsCopy.en.titleLabel).props.value).toBe('A changed synthetic title');
  expect(screen.queryByText(storyDetailsCopy.en.saved)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.cancel }));
  expect(screen.getByLabelText(storyDetailsCopy.en.titleLabel).props.value).toBe('A changed synthetic title');
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  expect(screen.getByRole('header', { name: 'A made-up summer memory' })).toBeOnTheScreen();
  expect(screen.queryByText('A changed synthetic title')).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('exercises the real Create form and Unicode validator without fake persistence', async () => {
  await render(<StoryPreview />); await samples(); await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  const input = screen.getByLabelText(createStoryCopy.en.titleLabel);
  await fireEvent.changeText(input, '\u0085'); await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
  expect(screen.getByRole('alert')).toHaveTextContent(createStoryCopy.en.validation.required);
  await fireEvent.changeText(input, 'Synthetic valid title'); await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.create }));
  expect(screen.queryByText(createStoryCopy.en.success)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: createStoryCopy.en.back }));
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  expect(screen.getByRole('header', { name: storiesCopy.en.title })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'Synthetic valid title' })).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('supports Swedish samples and safely labels unknown status', async () => {
  await render(<StoryPreview />); await changeToSwedish();
  expect(screen.getByText('EXEMPELBERÄTTELSER. Inget sparas.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Visa exempelberättelser' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Öppna berättelse: Ett påhittat sommarminne' }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.sv.more }));
  expect(screen.getByText('Status: Annan status')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.sv.edit }));
  expect(screen.getByLabelText(storyDetailsCopy.sv.titleLabel).props.value).toBe('Ett påhittat sommarminne');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('drops typed drafts on background and keeps Welcome on resume without account cleanup', async () => {
  const changes = jest.spyOn(AppState, 'addEventListener');
  try {
    await render(<StoryPreview />); await samples(); await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Private synthetic draft');
    await act(() => { changes.mock.calls[0][1]('background'); });
    expect(screen.queryByLabelText(createStoryCopy.en.titleLabel)).toBeNull();
    await samples();
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
    await act(() => { changes.mock.calls[0][1]('background'); changes.mock.calls[0][1]('active'); });
    expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
    await samples();
    expect(screen.getByRole('header', { name: storiesCopy.en.title })).toBeOnTheScreen();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally { changes.mockRestore(); }
});

it.each(['list', 'create', 'details', 'edit'] as const)('sample Sign Out from %s returns to Welcome and discards drafts', async where => {
  await render(<StoryPreview />); await samples();
  if (where === 'create') {
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
    await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'Discard this sample draft');
  } else if (where === 'details' || where === 'edit') {
    await fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
    if (where === 'edit') {
      await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
      await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
      await fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Discard this sample draft');
    }
  }
  await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
  if (where === 'create' || where === 'edit') {
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.keep }));
    const label = where === 'create' ? createStoryCopy.en.titleLabel : storyDetailsCopy.en.titleLabel;
    expect(screen.getByLabelText(label).props.value).toBe('Discard this sample draft');
    await fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
    await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  }
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByText('The sample preview is closed.')).toBeNull();
  expect(screen.queryByText('Discard this sample draft')).toBeNull();
  await samples();
  expect(screen.getByText('A made-up summer memory')).toBeOnTheScreen();
  expect(screen.queryByText('Discard this sample draft')).toBeNull();
});

it('Exit Preview returns to the isolated Welcome without changing the selected language', async () => {
  await render(<StoryPreview />); await changeToSwedish();
  await fireEvent.press(screen.getByRole('button', { name: 'Visa exempelberättelser' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Lämna förhandsvisningen / Till Välkommen' }));
  expect(screen.getByRole('header', { name: copy.sv.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: copy.sv.changeLanguage }));
  expect(screen.getByRole('radio', { name: 'Svenska' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: introCopy.sv.back }));
  expect(screen.getByRole('header', { name: copy.sv.welcomeTitle })).toBeOnTheScreen();
});

it('replays all three real animated scenes and returns to the isolated Welcome', async () => {
  await render(<StoryPreview />);
  await fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  for (let scene = 0; scene < 3; scene++) {
    expect(screen.getByRole('header', { name: introCopy.en.scenes[scene].title })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: scene === 2 ? introCopy.en.enter : introCopy.en.next }));
  }
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  await fireEvent.press(screen.getByRole('button', { name: introCopy.en.back }));
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: introCopy.en.replay }));
  await fireEvent.press(screen.getByRole('button', { name: introCopy.en.skip }));
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
});

it('uses Android Back for Edit → Details → My Stories → Welcome, then leaves Back to the host', async () => {
  const events = jest.spyOn(BackHandler, 'addEventListener');
  const back = async () => {
    const last = events.mock.calls[events.mock.calls.length - 1][1];
    let handled: boolean | null | undefined;
    await act(() => { handled = last({} as Parameters<typeof last>[0]); }); return handled;
  };
  await render(<StoryPreview />); await samples();
  await fireEvent.press(screen.getByRole('button', { name: 'Open story: A made-up summer memory' }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.edit }));
  await fireEvent.changeText(screen.getByLabelText(storyDetailsCopy.en.titleLabel), 'Unretained sample edit');
  expect(await back()).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  expect(screen.getByRole('button', { name: storyDetailsCopy.en.edit })).toBeOnTheScreen();
  expect(await back()).toBe(true);
  expect(screen.getByRole('header', { name: storiesCopy.en.title })).toBeOnTheScreen();
  expect(await back()).toBe(true);
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(await back()).toBe(false);
});

it('restarts the sample workspace at Welcome without reading or overwriting real onboarding preferences', async () => {
  const first = await render(<StoryPreview />); await changeToSwedish(); await first.unmount();
  await render(<StoryPreview />);
  expect(screen.getByRole('header', { name: copy.en.welcomeTitle })).toBeOnTheScreen();
  expect(screen.queryByText('Ett påhittat sommarminne')).toBeNull();
});

it('removes every preview lifecycle and Back listener when changing screens and unmounting', async () => {
  const lifecycle = jest.mocked(AppState.addEventListener);
  const back = jest.mocked(BackHandler.addEventListener);
  const view = await render(<StoryPreview />); await samples();
  await fireEvent.press(screen.getByRole('button', { name: 'Exit Preview / Return to Welcome' }));
  await view.unmount();
  for (const result of [...lifecycle.mock.results, ...back.mock.results]) {
    if (result.type === 'return') expect(result.value.remove).toHaveBeenCalledTimes(1);
  }
});
