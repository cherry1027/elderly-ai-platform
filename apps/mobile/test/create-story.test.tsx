import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CreateStory } from '../src/stories/CreateStory';
import { readMobileApiConfig } from '../src/api/config';
import { createStoryProject, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { createStoryCopy } from '../src/create-story-copy';

jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), createStoryProject: jest.fn() }));
const user = { id: 'account-a', email: 'account-a@example.test' };
const token = jest.fn(async () => 'synthetic-account-access-token');
const onBack = jest.fn(); const onSignOut = jest.fn();
const text = createStoryCopy.en;
const project = (title = 'My childhood'): StoryProject => ({ id: '10000000-0000-4000-8000-000000000001', title,
  description: null, language: 'en', status: 'draft', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' });
const open = () => render(<CreateStory language="en" user={user} getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
function save(title = '  My childhood  ') {
  fireEvent.changeText(screen.getByLabelText(text.titleLabel), title);
  fireEvent.press(screen.getByRole('button', { name: text.create }));
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(createStoryProject).mockResolvedValue(project());
});
it('does not create anything merely by opening the form', () => {
  open(); expect(createStoryProject).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});
it('cannot create a project, obtain a token or show success without backend configuration', async () => {
  jest.mocked(readMobileApiConfig).mockReturnValue(null); open(); save();
  expect(createStoryProject).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(screen.queryByText(text.success)).toBeNull();
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('  My childhood  ');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('submits cleaned fields once, using the verified owner token callback, and only then shows success', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open(); save();
  fireEvent.press(screen.getByRole('button', { name: text.saving }));
  expect(createStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(text.success)).toBeNull();
  const call = jest.mocked(createStoryProject).mock.calls[0][0];
  expect(call.input).toEqual({ title: 'My childhood', language: 'en' });
  await expect(call.getAccessToken()).resolves.toBe('synthetic-account-access-token');
  expect(token).toHaveBeenCalledWith('account-a');
  await act(async () => { finish(project()); });
  expect(screen.getByText(text.success)).toBeOnTheScreen(); expect(screen.getByText('My childhood')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.create })).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(['forbidden', 'conflict', 'validation'] as const)('allows correction after a definitive %s rejection without exposing server details', async kind => {
  jest.mocked(createStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind));
  open(); save(); await screen.findByText(text.errors[kind]);
  expect(screen.queryByText(text.success)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: text.create }));
  await waitFor(() => expect(createStoryProject).toHaveBeenCalledTimes(2));
});
it.each(['network', 'timeout', 'unavailable', 'invalid-response'] as const)('prevents a blind duplicate after an uncertain %s result', async kind => {
  jest.mocked(createStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
  open(); save(); await screen.findByText(text.uncertain);
  expect(screen.getByRole('button', { name: text.create })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: text.create }));
  expect(createStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(text.success)).toBeNull();
});
it('requires ordinary sign-in after an expired or rejected token', async () => {
  jest.mocked(createStoryProject).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  open(); save(); await screen.findByText(text.errors.authentication);
  expect(screen.getByRole('button', { name: text.create })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: text.signOut })); expect(onSignOut).toHaveBeenCalledTimes(1);
});
it.each(['back', 'signOut'] as const)('aborts on %s immediately and ignores a late write response', async action => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); save(); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: action === 'back' ? text.cancel : text.signOut }));
  expect(signal.aborted).toBe(true);
  expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
  await act(async () => { finish(project('Late private response')); });
  expect(screen.queryByText('Late private response')).toBeNull();
  view.unmount();
});
it('cancels and clears form data immediately when accounts change', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); save('Private account A draft');
  const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  view.rerender(<CreateStory language="sv" user={{ id: 'account-b', email: 'account-b@example.test' }}
    getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText(createStoryCopy.sv.titleLabel).props.value).toBe('');
  await act(async () => { finish(project('Private account A response')); });
  expect(screen.queryByText('Private account A response')).toBeNull();
  expect(screen.queryByText(createStoryCopy.sv.success)).toBeNull();
});
it('aborts on unmount and cannot publish success to a detached form', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(createStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); save(); const signal = jest.mocked(createStoryProject).mock.calls[0][0].signal!;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project()); }); expect(view.toJSON()).toBeNull();
});
