import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { StoryDetails } from '../src/stories/StoryDetails';
import { EditStoryScreen } from '../src/screens/EditStoryScreen';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { readMobileApiConfig } from '../src/api/config';
import { getStoryProject, updateStoryProject, StoryProjectsError, type StoryProject } from '../src/api/story-projects';
import { storyDetailsCopy } from '../src/story-details-copy';

jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  getStoryProject: jest.fn(), updateStoryProject: jest.fn() }));
const id = '10000000-0000-4000-8000-000000000001';
const nextId = '10000000-0000-4000-8000-000000000002';
const user = { id: 'account-a', email: 'a@example.test' };
const token = jest.fn(async () => 'synthetic-account-access-token');
const onBack = jest.fn(); const onSignOut = jest.fn();
const text = storyDetailsCopy.en;
const project = (overrides: Partial<StoryProject> = {}): StoryProject => ({ id, title: 'Fresh server title',
  description: 'Fresh description', language: 'sv', status: 'draft',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides });
const open = (props: Partial<React.ComponentProps<typeof StoryDetails>> = {}) => render(<StoryDetails
  language="en" user={user} projectId={id} getAccessToken={token} onBack={onBack} onSignOut={onSignOut} {...props} />);
async function edit() {
  await screen.findByText('Fresh server title');
  fireEvent.press(screen.getByRole('button', { name: text.edit }));
  expect(screen.getByRole('header', { name: text.editTitle })).toBeOnTheScreen();
}
function save(title = '  Corrected title  ', description = 'Private draft\nSecond line') {
  fireEvent.changeText(screen.getByLabelText(text.titleLabel), title);
  fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), description);
  fireEvent.press(screen.getByRole('button', { name: text.save }));
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(getStoryProject).mockResolvedValue(project());
  jest.mocked(updateStoryProject).mockResolvedValue(project({ title: 'Corrected title', description: 'Private draft\nSecond line' }));
});

it('loads the selected UUID afresh with the expected verified owner and never edits merely by opening', async () => {
  open(); await screen.findByText('Fresh server title');
  expect(getStoryProject).toHaveBeenCalledTimes(1);
  const call = jest.mocked(getStoryProject).mock.calls[0][0];
  expect(call.projectId).toBe(id);
  await expect(call.getAccessToken()).resolves.toBe('synthetic-account-access-token');
  expect(token).toHaveBeenCalledWith(user.id);
  expect(updateStoryProject).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['', '../other', `${id}?owner=other`, 'not-a-uuid'])('rejects an invalid selection before token or network operations (%#)', async projectId => {
  open({ projectId });
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.validation);
  expect(getStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('cannot load, edit, save or fabricate a project when configuration is absent', async () => {
  jest.mocked(readMobileApiConfig).mockReturnValue(null); open();
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.configuration);
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: text.refresh }));
  expect(getStoryProject).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled(); expect(screen.queryByText(text.saved)).toBeNull();
});

it.each(['forbidden', 'not-found', 'network', 'timeout', 'invalid-response'] as const)('reports a safe %s GET failure and permits an explicit fresh read', async kind => {
  jest.mocked(getStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind));
  open(); await screen.findByText(text.errors[kind]);
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: text.refresh }));
  await screen.findByText('Fresh server title'); expect(getStoryProject).toHaveBeenCalledTimes(2);
  expect(updateStoryProject).not.toHaveBeenCalled();
});

it('keeps a rejected authenticated GET closed until normal sign-out', async () => {
  jest.mocked(getStoryProject).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  open(); await screen.findByText(text.errors.authentication);
  expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: text.signOut }));
  expect(onSignOut).toHaveBeenCalledTimes(1); expect(getStoryProject).toHaveBeenCalledTimes(1);
});

it('preserves current language and shows a saved result only after the PATCH confirms it', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open(); await edit(); save();
  await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(text.saved)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: text.saving }));
  expect(updateStoryProject).toHaveBeenCalledTimes(1);
  const call = jest.mocked(updateStoryProject).mock.calls[0][0];
  expect(call.projectId).toBe(id); expect(call.expectedLanguage).toBe('sv');
  expect(call.input).toEqual({ title: 'Corrected title', description: 'Private draft\nSecond line' });
  expect(call.input).not.toHaveProperty('language');
  await call.getAccessToken(); expect(token).toHaveBeenCalledWith(user.id);
  await act(async () => { finish(project({ title: 'Corrected title', description: 'Private draft\nSecond line' })); });
  expect(screen.getByText(text.saved)).toBeOnTheScreen();
  expect(screen.getByText('Corrected title')).toBeOnTheScreen();
  expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
});

it('turns an empty description into explicit null without changing the story language', async () => {
  open(); await edit(); save('Corrected title', '');
  await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
  expect(jest.mocked(updateStoryProject).mock.calls[0][0].input).toEqual({ title: 'Corrected title', description: null });
});

it('validates again at the controller boundary before the PATCH transport', async () => {
  open(); await edit();
  const submit = screen.UNSAFE_getByType(EditStoryScreen).props.onSubmit;
  act(() => submit({ title: '\u200b', description: null }));
  expect(updateStoryProject).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  expect(screen.queryByText(text.saved)).toBeNull();
});

it.each(['forbidden', 'validation', 'conflict'] as const)('preserves drafts after a definitive %s PATCH rejection', async kind => {
  jest.mocked(updateStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind));
  open(); await edit(); save(); await screen.findByText(text.errors[kind]);
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('  Corrected title  ');
  expect(screen.getByLabelText(text.descriptionLabel).props.value).toBe('Private draft\nSecond line');
  expect(screen.getByRole('button', { name: text.save })).toBeEnabled();
  expect(screen.queryByText(text.saved)).toBeNull();
});

it.each(['network', 'timeout', 'unavailable', 'invalid-response'] as const)('blocks blind retry after an uncertain %s PATCH and reconciles through a fresh GET', async kind => {
  jest.mocked(updateStoryProject).mockRejectedValueOnce(new StoryProjectsError(kind, undefined, true));
  open(); await edit(); save(); await screen.findByText(text.uncertain);
  const saveButton = screen.getByRole('button', { name: text.save });
  expect(saveButton).toBeDisabled(); fireEvent.press(saveButton);
  expect(updateStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: text.cancel }));
  await screen.findByText('Fresh server title'); expect(getStoryProject).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(text.saved)).toBeNull(); expect(updateStoryProject).toHaveBeenCalledTimes(1);
});

it('locks a rejected PATCH session and does not silently GET or PATCH with it again', async () => {
  jest.mocked(updateStoryProject).mockRejectedValueOnce(new StoryProjectsError('authentication', 401));
  open(); await edit(); save(); await screen.findByText(text.errors.authentication);
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: text.cancel }));
  expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  expect(getStoryProject).toHaveBeenCalledTimes(1); expect(updateStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: text.signOut })); expect(onSignOut).toHaveBeenCalledTimes(1);
});

it.each(['back', 'signOut'] as const)('aborts pending GET immediately on %s and ignores its late private result', async action => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(getStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open(); await waitFor(() => expect(getStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(getStoryProject).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: text[action] }));
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(project({ title: 'Late private metadata' })); });
  expect(screen.queryByText('Late private metadata')).toBeNull();
  expect(action === 'back' ? onBack : onSignOut).toHaveBeenCalledTimes(1);
});

it.each(['account', 'project'] as const)('fences a pending PATCH and private drafts when the selected %s changes', async change => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); await edit(); save(); await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  const nextUser = change === 'account' ? { id: 'account-b', email: 'b@example.test' } : user;
  const selected = change === 'project' ? nextId : id;
  jest.mocked(getStoryProject).mockResolvedValueOnce(project({ id: selected, title: 'Fresh next selection' }));
  view.rerender(<StoryDetails language="en" user={nextUser} projectId={selected} getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
  await screen.findByText('Fresh next selection'); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project({ title: 'Late old update' })); });
  expect(screen.queryByText('Late old update')).toBeNull(); expect(screen.queryByText(text.saved)).toBeNull();
  await jest.mocked(getStoryProject).mock.calls[1][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith(nextUser.id);
});

it('ignores a stale Edit callback belonging to the previous account', async () => {
  const view = open(); await screen.findByText('Fresh server title');
  const oldEdit = screen.UNSAFE_getByType(StoryDetailsScreen).props.onEdit;
  jest.mocked(getStoryProject).mockResolvedValueOnce(project({ title: 'Account B details' }));
  view.rerender(<StoryDetails language="en" user={{ id: 'account-b', email: 'b@example.test' }} projectId={id}
    getAccessToken={token} onBack={onBack} onSignOut={onSignOut} />);
  await screen.findByText('Account B details');
  act(() => oldEdit());
  expect(screen.getByText('Account B details')).toBeOnTheScreen();
  expect(screen.queryByLabelText(text.titleLabel)).toBeNull(); expect(updateStoryProject).not.toHaveBeenCalled();
});

it('cancels an edit with Android Back and reloads before another edit', async () => {
  let hardwareBack: (() => boolean | null | undefined) | undefined;
  const original = BackHandler.addEventListener;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'hardwareBackPress') hardwareBack = () => listener({ type: 'hardwareBackPress', timeStamp: 0 });
    return { remove: jest.fn() };
  });
  try {
    let finish!: (value: StoryProject) => void;
    jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    open(); await edit(); save(); await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
    const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
    act(() => { expect(hardwareBack?.()).toBe(true); });
    await screen.findByText('Fresh server title'); expect(signal.aborted).toBe(true);
    expect(getStoryProject).toHaveBeenCalledTimes(2); expect(onBack).not.toHaveBeenCalled();
    await act(async () => { finish(project({ title: 'Late update after Back' })); });
    expect(screen.queryByText('Late update after Back')).toBeNull();
  } finally { BackHandler.addEventListener = original; }
});

it('clears private edit data on Sign Out even when the parent callback does not unmount it', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open(); await edit(); save(); await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  fireEvent.press(screen.getByRole('button', { name: text.signOut }));
  expect(signal.aborted).toBe(true); expect(onSignOut).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText(text.titleLabel)).toBeNull();
  expect(screen.queryByText('Fresh server title')).toBeNull();
  expect(screen.queryByText('Fresh description')).toBeNull();
  await act(async () => { finish(project({ title: 'Late private update' })); });
  expect(screen.queryByText('Late private update')).toBeNull(); expect(screen.queryByText(text.saved)).toBeNull();
});

it('aborts a pending PATCH on unmount and publishes no late success or logs', async () => {
  let finish!: (value: StoryProject) => void;
  jest.mocked(updateStoryProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = open(); await edit(); save(); await waitFor(() => expect(updateStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(updateStoryProject).mock.calls[0][0].signal!;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(project({ title: 'Late detached result' })); });
  expect(view.toJSON()).toBeNull(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
