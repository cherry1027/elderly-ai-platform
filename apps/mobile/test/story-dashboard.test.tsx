import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StoryDashboard } from '../src/stories/StoryDashboard';
import { readMobileApiConfig } from '../src/api/config';
import { listStoryProjects, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { storiesCopy } from '../src/stories-copy';

jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStoryProjects: jest.fn() }));
const project = (title: string): StoryProject => ({ id: '10000000-0000-4000-8000-000000000001', title,
  description: null, language: 'en', status: 'draft', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' });
const user = { id: 'account-a', email: 'a@example.test' };
const token = jest.fn(async () => 'synthetic-user-access-token');
const signOut = jest.fn();
const createStory = jest.fn();
function open(props: Partial<React.ComponentProps<typeof StoryDashboard>> = {}) {
  return render(<StoryDashboard language="en" user={user} getAccessToken={token} onCreateStory={createStory} onSignOut={signOut} {...props} />);
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStoryProjects).mockResolvedValue([]);
});
it('stays disconnected when there is no approved configuration', async () => {
  jest.mocked(readMobileApiConfig).mockReturnValue(null);
  open();
  await screen.findByText(storiesCopy.en.errors.configuration);
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  expect(createStory).toHaveBeenCalledTimes(1);
  expect(listStoryProjects).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Sign Out' })); expect(signOut).toHaveBeenCalledTimes(1);
});
it('forwards an intentional creation action without reloading or writing projects', async () => {
  open(); await screen.findByText(storiesCopy.en.empty);
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.createStory }));
  expect(createStory).toHaveBeenCalledTimes(1);
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
  expect(token).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('does not forward creation after the story service rejects authentication', async () => {
  jest.mocked(listStoryProjects).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  open(); await screen.findByText(storiesCopy.en.errors.authentication);
  const create = screen.getByRole('button', { name: storiesCopy.en.createStory });
  expect(create).toBeDisabled(); fireEvent.press(create);
  expect(createStory).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.signOut }));
  expect(signOut).toHaveBeenCalledTimes(1);
});
it('loads once with the verified owner token accessor and preserves backend order', async () => {
  jest.mocked(listStoryProjects).mockResolvedValue([project('Newest'), { ...project('Older'), id: '10000000-0000-4000-8000-000000000002', language: 'sv' }]);
  open();
  await screen.findByText('Newest'); expect(screen.getByText('Older')).toBeOnTheScreen();
  const call = jest.mocked(listStoryProjects).mock.calls[0][0];
  await expect(call.getAccessToken()).resolves.toBe('synthetic-user-access-token');
  expect(token).toHaveBeenCalledWith('account-a');
  expect(listStoryProjects).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('refreshes by replacing rows, clearing stale rows while loading and preventing duplicate submissions', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Before refresh')]);
  open(); await screen.findByText('Before refresh');
  let finish!: (rows: StoryProject[]) => void;
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const button = screen.getByRole('button', { name: storiesCopy.en.refresh });
  fireEvent.press(button); fireEvent.press(button);
  expect(screen.queryByText('Before refresh')).toBeNull();
  expect(screen.getByRole('button', { name: storiesCopy.en.refreshing })).toBeDisabled();
  expect(listStoryProjects).toHaveBeenCalledTimes(2);
  await act(async () => { finish([project('After refresh')]); });
  expect(screen.getAllByText('After refresh')).toHaveLength(1);
});
it.each(['forbidden', 'not-found', 'validation', 'conflict', 'unavailable', 'network', 'timeout', 'invalid-response'] as const)('renders a safe %s failure and permits retry', async kind => {
  jest.mocked(listStoryProjects).mockRejectedValueOnce(new StoryProjectsError(kind));
  open(); await screen.findByText(storiesCopy.en.errors[kind]);
  expect(screen.getByRole('button', { name: storiesCopy.en.refresh })).toBeEnabled();
  expect(screen.queryByText('synthetic-user-access-token')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: storiesCopy.en.refresh }));
  await waitFor(() => expect(listStoryProjects).toHaveBeenCalledTimes(2));
});
it('cancels on unmount and never publishes a late response', async () => {
  let finish!: (rows: StoryProject[]) => void;
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); const signal = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish([project('Private old rows')]); });
  expect(view.toJSON()).toBeNull();
});
it('immediately fences an account switch, aborts old work and ignores out-of-order completion', async () => {
  let finishA!: (rows: StoryProject[]) => void;
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
  const view = open(); const signalA = jest.mocked(listStoryProjects).mock.calls[0][0].signal!;
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Only account B')]);
  view.rerender(<StoryDashboard language="en" user={{ id: 'account-b', email: 'b@example.test' }} getAccessToken={token} onCreateStory={createStory} onSignOut={signOut} />);
  await screen.findByText('Only account B'); expect(signalA.aborted).toBe(true);
  await act(async () => { finishA([project('Private account A')]); });
  expect(screen.queryByText('Private account A')).toBeNull();
  const getTokenB = jest.mocked(listStoryProjects).mock.calls[1][0].getAccessToken;
  await getTokenB(); expect(token).toHaveBeenLastCalledWith('account-b');
});
it('clears completed rows on an account switch before replacement loading finishes', async () => {
  jest.mocked(listStoryProjects).mockResolvedValueOnce([project('Private account A')]);
  const view = open(); await screen.findByText('Private account A');
  jest.mocked(listStoryProjects).mockImplementationOnce(() => new Promise(() => {}));
  view.rerender(<StoryDashboard language="sv" user={{ id: 'account-b', email: 'b@example.test' }} getAccessToken={token} onCreateStory={createStory} onSignOut={signOut} />);
  expect(screen.queryByText('Private account A')).toBeNull();
});
