import { getComponent, getComponents } from './component-probe';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import { CreateStory } from '../src/stories/CreateStory';
import { StoryDetails } from '../src/stories/StoryDetails';
import { StoryDashboard } from '../src/stories/StoryDashboard';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { AccountAction } from '../src/components/AccountPresentation';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { createStoryCopy } from '../src/create-story-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { storiesCopy } from '../src/stories-copy';
import { readMobileApiConfig } from '../src/api/config';
import { getStoryProject, updateStoryProject, createStoryProject, listStoryProjects,
  StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';

jest.mock('../src/components/AccountPresentation', () => { const actual = jest.requireActual<typeof import('../src/components/AccountPresentation')>('../src/components/AccountPresentation'); return { ...actual, AccountAction: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.AccountAction) }; });
jest.mock('../src/screens/StoryDetailsScreen', () => { const actual = jest.requireActual<typeof import('../src/screens/StoryDetailsScreen')>('../src/screens/StoryDetailsScreen'); return { ...actual, StoryDetailsScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.StoryDetailsScreen) }; });
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  getStoryProject: jest.fn(), updateStoryProject: jest.fn(), createStoryProject: jest.fn(), listStoryProjects: jest.fn() }));
const owner = { id: 'fictional-account-a', email: 'fictional-a@example.test' };
const other = { id: 'fictional-account-b', email: 'fictional-b@example.test' };
const projectId = '10000000-0000-4000-8000-000000000001';
const token = jest.fn(async (_owner: string) => 'synthetic-user-access-token');
const onBack = jest.fn(), onSignOut = jest.fn();
const project = (language: Language): StoryProject => ({ id: projectId, title: 'Saved fictional story',
  description: 'Original fictional description', language, status: 'draft',
  created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:00:00Z' });
type BackCallback = Parameters<typeof BackHandler.addEventListener>[1];
let backListeners: Set<BackCallback>;
const hardwareBack = async () => {
  const latest = [...backListeners].at(-1);
  expect(latest).toBeDefined(); await act(() => { expect(latest!({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true); });
};
const modalAction = (label: string) => getComponents(AccountAction)
  .find(item => item.props.label === label)!.props.onPress as () => void;
const button = (label: string) => screen.getByRole('button', { name: label });
beforeEach(() => {
  backListeners = new Set();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    backListeners.add(listener); return { remove: () => { backListeners.delete(listener); } };
  });
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(getStoryProject).mockResolvedValue(project('en'));
  jest.mocked(listStoryProjects).mockResolvedValue([project('en')]);
  jest.mocked(createStoryProject).mockResolvedValue(project('en'));
  jest.mocked(updateStoryProject).mockResolvedValue(project('en'));
});
afterEach(() => { jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });
const createProps = (language: Language, user = owner) => ({ language, user, getAccessToken: token, onBack, onSignOut });
const editProps = (language: Language, user = owner) => ({ ...createProps(language, user), projectId });
async function openEditor(language: Language) {
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  const view = await render(<StoryDetails {...editProps(language)} />);
  await screen.findByRole('header', { name: project(language).title });
  const workspace = getComponent(StoryDetailsScreen).props;
  await fireEvent.press(button(storyDetailsCopy[language].more)); await fireEvent.press(button(storyDetailsCopy[language].edit));
  return { view, workspace };
}
async function changeEditor(language: Language) {
  const text = storyDetailsCopy[language];
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A fictional edited title');
  await fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'A private fictional description\nwith two lines.');
}
function retainedEditor(language: Language) {
  const text = storyDetailsCopy[language];
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('A fictional edited title');
  expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe('A private fictional description\nwith two lines.');
}

it.each<Language>(['en', 'sv'])('%s Create visible Back and hardware Back share the guard and Keep preserves title and language', async language => {
  await render(<CreateStory {...createProps(language)} />);
  const text = createStoryCopy[language], leave = leaveCopy[language];
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A private fictional summer');
  const chosen = language === 'en' ? text.swedish : text.english;
  await fireEvent.press(screen.getByRole('radio', { name: chosen }));
  await fireEvent.press(button(text.back)); expect(screen.getByText(leave.dirty)).toBeOnTheScreen();
  expect(onBack).not.toHaveBeenCalled(); await fireEvent.press(button(leave.keep));
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('A private fictional summer');
  expect(screen.getByRole('radio', { name: chosen })).toBeChecked();
  await hardwareBack(); expect(onBack).not.toHaveBeenCalled(); await fireEvent.press(button(leave.keep));
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('A private fictional summer');
  await hardwareBack(); await fireEvent.press(button(leave.discard)); expect(onBack).toHaveBeenCalledTimes(1);
  expect(createStoryProject).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('%s Edit Keep preserves both fields and hardware discard reconciles with a fresh GET only', async language => {
  await openEditor(language); await changeEditor(language);
  const text = storyDetailsCopy[language], leave = leaveCopy[language];
  await fireEvent.press(button(text.cancel)); expect(screen.getByText(leave.dirty)).toBeOnTheScreen();
  await fireEvent.press(button(leave.keep)); retainedEditor(language);
  await hardwareBack(); await fireEvent.press(button(leave.keep)); retainedEditor(language);
  await hardwareBack(); await fireEvent.press(button(leave.discard));
  await screen.findByRole('header', { name: project(language).title });
  expect(getStoryProject).toHaveBeenCalledTimes(2); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
});

it.each((['en', 'sv'] as const).flatMap(language => (['onBack', 'onSignOut'] as const).map(action => ({ language, action }))))(
  '$language captured workspace $action cannot bypass a newer dirty editor', async ({ language, action }) => {
    const { workspace } = await openEditor(language); await changeEditor(language);
    await act(() => workspace[action]()); expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen();
    expect(onBack).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
    await fireEvent.press(button(leaveCopy[language].keep)); retainedEditor(language);
    expect(updateStoryProject).not.toHaveBeenCalled(); expect(getStoryProject).toHaveBeenCalledTimes(1);
  });

function CreateThenList({ language }: { language: Language }) {
  const [creating, setCreating] = useState(true);
  return creating ? <CreateStory {...createProps(language)} onBack={() => setCreating(false)} />
    : <StoryDashboard language={language} user={owner} getAccessToken={token} onSignOut={onSignOut} onCreateStory={() => setCreating(true)} />;
}
it.each<Language>(['en', 'sv'])('%s uncertain Create offers an explicit saved-result read without repeating the POST', async language => {
  jest.mocked(createStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  jest.mocked(listStoryProjects).mockResolvedValue([project(language)]);
  await render(<CreateThenList language={language} />); const text = createStoryCopy[language], leave = leaveCopy[language];
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'An uncertain fictional creation');
  await fireEvent.press(button(text.create)); await screen.findByText(text.uncertain);
  await fireEvent.press(button(text.back)); expect(screen.getByText(leave.uncertain)).toBeOnTheScreen();
  expect(screen.queryByText(leave.dirty)).toBeNull(); expect(listStoryProjects).not.toHaveBeenCalled();
  await fireEvent.press(button(leave.keep)); expect(screen.getByLabelText(text.titleLabel).props.value).toBe('An uncertain fictional creation');
  await fireEvent.press(button(text.back)); await fireEvent.press(button(leave.check));
  await screen.findByRole('header', { name: storiesCopy[language].title }); await screen.findByText(project(language).title);
  expect(listStoryProjects).toHaveBeenCalledTimes(1); expect(createStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(text.success)).toBeNull();
  await jest.mocked(listStoryProjects).mock.calls[0][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith(owner.id);
});

it.each<Language>(['en', 'sv'])('%s uncertain Edit Keep retains text and explicit saved-result check performs GET, never PATCH retry', async language => {
  jest.mocked(updateStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await openEditor(language); await changeEditor(language);
  const text = storyDetailsCopy[language], leave = leaveCopy[language];
  await fireEvent.press(button(text.save)); await screen.findByText(text.uncertain);
  await fireEvent.press(button(text.cancel)); expect(screen.getByText(leave.uncertain)).toBeOnTheScreen();
  await fireEvent.press(button(leave.keep)); retainedEditor(language);
  expect(button(text.save)).toBeDisabled(); expect(getStoryProject).toHaveBeenCalledTimes(1);
  await fireEvent.press(button(text.cancel)); await fireEvent.press(button(leave.check));
  await screen.findByRole('header', { name: project(language).title });
  expect(getStoryProject).toHaveBeenCalledTimes(2); expect(updateStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(text.saved)).toBeNull();
});

it.each((['en', 'sv'] as const).flatMap(language => (['create', 'edit'] as const).map(form => ({ language, form }))))(
  '$language $form account change retires an already-open confirmation and removes the old private draft', async ({ language, form }) => {
    const leave = leaveCopy[language];
    const view = form === 'create' ? await render(<CreateStory {...createProps(language)} />) : (await openEditor(language)).view;
    if (form === 'create') {
      await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), 'Private account A draft');
      await fireEvent.press(button(createStoryCopy[language].back));
    } else { await changeEditor(language); await fireEvent.press(button(storyDetailsCopy[language].cancel)); }
    const stale = modalAction(leave.discard);
    await view.rerender(form === 'create' ? <CreateStory {...createProps(language, other)} /> : <StoryDetails {...editProps(language, other)} />);
    await act(() => stale()); expect(onBack).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByText(leave.title)).toBeNull();
    if (form === 'create') expect(screen.getByLabelText(createStoryCopy[language].titleLabel).props.value).toBe('');
    else { await screen.findByRole('header', { name: project(language).title }); expect(screen.queryByLabelText(storyDetailsCopy[language].descriptionLabel)).toBeNull(); }
    expect(createStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  });

it.each((['en', 'sv'] as const).flatMap(language => (['create', 'edit'] as const).map(form => ({ language, form }))))(
  '$language $form unmount makes an old leave confirmation harmless', async ({ language, form }) => {
    const view = form === 'create' ? await render(<CreateStory {...createProps(language)} />) : (await openEditor(language)).view;
    if (form === 'create') {
      await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), 'Private disappearing draft');
      await fireEvent.press(button(createStoryCopy[language].back));
    } else { await changeEditor(language); await fireEvent.press(button(storyDetailsCopy[language].cancel)); }
    const stale = modalAction(leaveCopy[language].discard); await view.unmount(); await act(() => stale());
    expect(onBack).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
    expect(createStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  });

it.each<Language>(['en', 'sv'])('%s background privacy invalidates a waiting form intent instead of navigating when foreground returns', async language => {
  const listeners: ((state: 'active' | 'background') => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener); return { remove: jest.fn() };
  });
  await render(<CreateStory {...createProps(language)} />);
  await fireEvent.changeText(screen.getByLabelText(createStoryCopy[language].titleLabel), 'Private transient text');
  await fireEvent.press(button(createStoryCopy[language].back)); const stale = modalAction(leaveCopy[language].discard);
  await act(() => listeners.forEach(listener => listener('background')));
  expect(screen.queryByText(leaveCopy[language].title)).toBeNull();
  await act(() => { listeners.forEach(listener => listener('active')); stale(); });
  expect(onBack).not.toHaveBeenCalled(); expect(onSignOut).not.toHaveBeenCalled();
  expect(createStoryProject).not.toHaveBeenCalled();
});
