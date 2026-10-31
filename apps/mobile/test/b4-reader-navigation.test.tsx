import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { getComponent, maybeComponent } from './component-probe';
import { GenerateStory } from '../src/generation/GenerateStory';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { readMobileApiConfig } from '../src/api/config';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import { editStoryDraft, generateStoryDraft, getStoryDraft, getStoryVerification,
  listStoryDrafts, type StoryDraft } from '../src/api/story-drafts';
import type { StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';

jest.mock('../src/generation/StoryDraftScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/StoryDraftScreen')>('../src/generation/StoryDraftScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, StoryDraftScreen: observeComponent(actual.StoryDraftScreen) };
});
jest.mock('../src/generation/DraftEditorScreen', () => {
  const actual = jest.requireActual<typeof import('../src/generation/DraftEditorScreen')>('../src/generation/DraftEditorScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, DraftEditorScreen: observeComponent(actual.DraftEditorScreen) };
});
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'),
  editStoryDraft: jest.fn(), generateStoryDraft: jest.fn(), getStoryDraft: jest.fn(),
  getStoryVerification: jest.fn(), listStoryDrafts: jest.fn() }));

const projectId = '10000000-0000-4000-8000-000000000001';
const draftId = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-10-24T10:00:00Z';
const back = jest.fn(), signOut = jest.fn(), review = jest.fn(), token = jest.fn(async () => 'synthetic-token');
const project = (language: Language): StoryProject => ({ id: projectId, title: 'Fictional story',
  language, description: null, status: 'draft', created_at: stamp, updated_at: stamp });
function saved(language: Language): StoryDraft {
  const content = language === 'sv' ? 'Jag växte upp i Malmö.' : 'I grew up in Malmö.';
  return { draft_id: draftId, project_id: projectId, language, style: 'warm', status: 'ready_for_review',
    version: 3, revision: 1, content, original_content: content, mode: 'mock', source_memories: [],
    verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
      checked_revision: 1, checked_at: stamp, sources_current: true, reason: null },
    created_at: stamp, updated_at: stamp };
}
const reader = () => getComponent(StoryDraftScreen).props;
const editor = () => getComponent(DraftEditorScreen).props;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required callback missing.');
  return value;
}
async function open(language: Language) {
  const value = saved(language);
  jest.mocked(getStoryDraft).mockResolvedValue(value);
  jest.mocked(listStoryDrafts).mockResolvedValue([value]);
  jest.mocked(getStoryVerification).mockResolvedValue({ project_id: projectId, draft_id: draftId,
    version: value.version, revision: value.revision, verification: value.verification });
  const view = await render(<GenerateStory language={language} project={project(language)}
    user={{ id: 'fictional-owner', email: 'fictional@example.test' }} getAccessToken={token}
    onBack={back} onSignOut={signOut} onReviewMemories={review} />);
  await waitFor(() => expect(reader().state.phase).toBe('ready'));
  return view;
}
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false);
  jest.mocked(editStoryDraft).mockReset(); jest.mocked(generateStoryDraft).mockReset();
  back.mockClear(); signOut.mockClear(); review.mockClear(); token.mockClear();
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it.each((['en', 'sv'] as const).flatMap(language =>
  (['onBack', 'onSignOut', 'onRefresh', 'onReviewMemories', 'onGenerate', 'onExport'] as const)
    .map(action => ({ language, action }))))(
  'rejects obsolete reader $action while the real dirty $language editor owns navigation', async ({ language, action }) => {
    await open(language); const stale = reader();
    await act(() => required(stale.onEdit)());
    await waitFor(() => expect(editor().state.phase).toBe('editing'));
    await act(() => editor().onChangeText('Fictional unsaved paragraphs.\n\nKeep these words.'));
    await act(() => required(stale[action])());
    expect(editor().state.text).toBe('Fictional unsaved paragraphs.\n\nKeep these words.');
    expect(editor().state.dirty).toBe(true);
    expect(maybeComponent(StoryDraftScreen)).toBeNull();
    expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
    expect(editStoryDraft).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

it.each(['onBack', 'onSignOut', 'onGenerate', 'onRefresh'] as const)(
  'does not revive the earlier reader %s after a child closes and a new saved read completes', async action => {
    await open('en'); const stale = reader();
    await act(() => required(stale.onEdit)()); await waitFor(() => expect(editor().state.phase).toBe('editing'));
    await act(() => editor().onBack()); await waitFor(() => expect(reader().state.phase).toBe('ready'));
    const reads = jest.mocked(getStoryDraft).mock.calls.length;
    await act(() => stale[action]());
    expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
    expect(generateStoryDraft).not.toHaveBeenCalled(); expect(getStoryDraft).toHaveBeenCalledTimes(reads);
    expect(reader().state.draft?.draft_id).toBe(draftId);
  });

it('ignores captured reader exits after background privacy teardown', async () => {
  let change: ((value: 'active' | 'background') => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    change = listener; return { remove: jest.fn() };
  });
  await open('en'); const stale = reader();
  await act(() => required(change)('background'));
  await act(() => { stale.onBack(); stale.onSignOut(); });
  expect(back).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled();
});
