import { fireEvent, render, screen } from '@testing-library/react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import type { StoryExport } from '../src/api/story-exports';
import type { StoryProject } from '../src/api/story-projects';
import { RecordingPanel } from '../src/audio/RecordingPanel';
import { audioCopy } from '../src/audio/audio-copy';
import { ConversationPanel } from '../src/conversation/ConversationPanel';
import { transcriptConversationCopy } from '../src/conversation/conversation-copy';
import { StoryExportsScreen } from '../src/exports/StoryExportsScreen';
import { exportCopy } from '../src/exports/export-copy';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { DraftHistoryScreen } from '../src/generation/DraftHistoryScreen';
import { GenerationBrowserScreen } from '../src/generation/GenerationBrowserScreen';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import { generationBrowserCopy } from '../src/generation/generation-browser-copy';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import { CreateStoryScreen } from '../src/screens/CreateStoryScreen';
import { EditStoryScreen } from '../src/screens/EditStoryScreen';
import { MyStoriesScreen } from '../src/screens/MyStoriesScreen';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { createStoryCopy } from '../src/create-story-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { storiesCopy } from '../src/stories-copy';
import { conversationCopy } from '../src/conversation-copy';
import { MemoryReviewScreen } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';

let mockWaiting = true;
jest.mock('../src/api/ApiBackoff', () => ({ useApiBackoff: () => ({ waiting: mockWaiting }), ApiBackoffBanner: () => null }));
beforeEach(() => { mockWaiting = true; });

const project: StoryProject = { id: '10000000-0000-4000-8000-000000000001', title: 'Fictional memories',
  description: null, language: 'en', status: 'draft', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' };
const draft: StoryDraft = { draft_id: '20000000-0000-4000-8000-000000000001', project_id: project.id,
  status: 'ready_for_review', language: 'en', style: 'warm', version: 1, revision: 1, content: 'My fictional wording.',
  original_content: 'My fictional wording.', mode: 'mock', source_memories: [],
  verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
    checked_at: project.created_at, sources_current: true, reason: null }, created_at: project.created_at, updated_at: project.updated_at };
const pdf: StoryExport = { export_id: '30000000-0000-4000-8000-000000000001', draft_id: draft.draft_id, project_id: project.id,
  draft_version: 1, draft_revision: 1, language: 'en', title: project.title, format: 'pdf', include_title_page: true,
  include_page_numbers: true, renderer_version: 'memy_pdf_v1', filename: 'memy-fictional.pdf',
  content_sha256: 'a'.repeat(64), byte_size: 4700, page_count: 1, created_at: project.created_at };
const source = { transcript_id: '40000000-0000-4000-8000-000000000001', session_id: '50000000-0000-4000-8000-000000000001',
  language: 'en' as const, status: 'completed' as const, created_at: project.created_at, text: 'A fictional saved transcript.' };
function button(label: string) { return screen.getByRole('button', { name: label }); }
async function blocked(label: string, callback: jest.Mock) {
  expect(button(label)).toBeDisabled(); await fireEvent.press(button(label)); await fireEvent.press(button(label));
  expect(callback).not.toHaveBeenCalled();
}

it.each(['en', 'sv'] as const)('preserves a new story form and requires an explicit submit after waiting in %s', async language => {
  const onSubmit = jest.fn(), onBack = jest.fn(), onSignOut = jest.fn(), text = createStoryCopy[language];
  const props = { language, state: { status: 'idle' as const }, serviceAvailable: true, onSubmit, onBack, onSignOut };
  const view = await render(<CreateStoryScreen {...props} />);
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A fictional summer');
  await fireEvent.press(screen.getByRole('radio', { name: text.swedish }));
  expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(true);
  await blocked(text.create, onSubmit);
  mockWaiting = false; await view.rerender(<CreateStoryScreen {...props} />);
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('A fictional summer');
  expect(onSubmit).not.toHaveBeenCalled(); await fireEvent.press(button(text.create)); await fireEvent.press(button(text.create));
  expect(onSubmit).toHaveBeenCalledTimes(1); expect(onSubmit).toHaveBeenCalledWith({ title: 'A fictional summer', language: 'sv' });
});

it.each(['en', 'sv'] as const)('keeps project metadata editable while only Save waits in %s', async language => {
  const onSubmit = jest.fn(), text = storyDetailsCopy[language];
  await render(<EditStoryScreen language={language} project={project} state={{ status: 'idle' }}
    onSubmit={onSubmit} onBack={jest.fn()} onSignOut={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'Changed fictional title');
  await fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'Changed description');
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('Changed fictional title');
  expect(screen.getByLabelText(text.descriptionLabel).props.editable).toBe(true); await blocked(text.save, onSubmit);
  expect(button(text.done)).toBeEnabled(); expect(button(text.cancel)).toBeEnabled(); expect(button(text.signOut)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('disables dashboard Refresh while leaving local navigation and Sign Out usable in %s', async language => {
  const onRefresh = jest.fn(), onCreateStory = jest.fn(), text = storiesCopy[language];
  await render(<MyStoriesScreen language={language} user={{ id: 'fictional-user', email: 'fictional@example.test' }}
    state={{ status: 'ready', projects: [project] }} onRefresh={onRefresh} onCreateStory={onCreateStory} onSignOut={jest.fn()} />);
  await blocked(text.refresh, onRefresh); expect(button(text.signOut)).toBeEnabled(); await fireEvent.press(button(text.createStory));
  expect(onCreateStory).toHaveBeenCalledTimes(1);
});

it('keeps details editing and Back available while disabling Reload', async () => {
  const onRefresh = jest.fn(), text = storyDetailsCopy.en;
  await render(<StoryDetailsScreen language="en" state={{ status: 'ready', project }} onRefresh={onRefresh}
    onEdit={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} />);
  await fireEvent.press(button(text.more));
  await blocked(text.refresh, onRefresh); expect(button(text.edit)).toBeEnabled(); expect(button(text.back)).toBeEnabled();
});

it('disables uncertain session checks without disabling leaving the session', async () => {
  const onCheck = jest.fn(), text = conversationCopy.en;
  await render(<ConversationScreen language="en" state={{ status: 'error', error: 'network', reconcile: true }}
    onCheck={onCheck} onBack={jest.fn()} onSignOut={jest.fn()} />);
  await blocked(text.check, onCheck); expect(button(text.back)).toBeEnabled(); expect(button(text.signOut)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('holds upload/history requests but preserves consent and recording controls in %s', async language => {
  const onUpload = jest.fn(), onRetryHistory = jest.fn(), text = audioCopy[language];
  const actions = { onStart: jest.fn(), onStop: jest.fn(), onConsentChange: jest.fn(), onUpload, onDiscard: jest.fn(), onRetryHistory };
  const view = await render(<RecordingPanel language={language} state={{ phase: 'ready', durationMs: 8000, consent: true,
    transcripts: [], hasRecording: true, historyFailed: true }} {...actions} />);
  await blocked(text.upload, onUpload); await blocked(text.retryHistory, onRetryHistory);
  expect(screen.getByRole('checkbox', { name: text.consent })).toBeEnabled(); expect(button(text.discard)).toBeEnabled();
  await view.rerender(<RecordingPanel language={language} state={{ phase: 'recording', durationMs: 8000, consent: false, transcripts: [] }} {...actions} />);
  await fireEvent.press(button(text.stop)); expect(actions.onStop).toHaveBeenCalledTimes(1); expect(onUpload).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('preserves transcript selection but disables processing, refresh and uncertain retry in %s', async language => {
  const text = transcriptConversationCopy[language], actions = { onSelect: jest.fn(), onProcess: jest.fn(), onReconcile: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn() };
  const state = { phase: 'ready' as const, messages: [], processedIds: [], complete: true, canRetry: false, selectedId: source.transcript_id };
  const view = await render(<ConversationPanel language={language} state={state} transcripts={[source]} {...actions} />);
  await blocked(text.process, actions.onProcess); await blocked(text.refresh, actions.onRefresh);
  expect(screen.getByRole('radio', { name: text.select + ' 1' })).toBeEnabled();
  await view.rerender(<ConversationPanel language={language} state={{ ...state, phase: 'uncertain', canRetry: true }} transcripts={[source]} {...actions} />);
  await blocked(text.reconcile, actions.onReconcile); await blocked(text.retry, actions.onRetry);
});

it.each(['en', 'sv'] as const)('keeps draft wording editable and does not save automatically when waiting ends in %s', async language => {
  const text = draftEditingCopy[language], actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
    onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const props = { language, storyLanguage: 'en' as const, title: project.title,
    state: { phase: 'editing' as const, draft, text: draft.content, canRetry: false, dirty: true }, ...actions };
  const view = await render(<DraftEditorScreen {...props} />); await blocked(text.save, actions.onSave);
  expect(screen.getByLabelText(text.field).props.editable).toBe(true); expect(button(text.done)).toBeEnabled();
  mockWaiting = false; await view.rerender(<DraftEditorScreen {...props} />); expect(actions.onSave).not.toHaveBeenCalled();
  await fireEvent.press(button(text.save)); expect(actions.onSave).toHaveBeenCalledTimes(1);
});

it('disables uncertain draft reconciliation and retry until waiting ends', async () => {
  const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(), onUseLatest: jest.fn(),
    onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() }, text = draftEditingCopy.en;
  await render(<DraftEditorScreen language="en" storyLanguage="en" title={project.title}
    state={{ phase: 'uncertain', draft, text: draft.content, dirty: true, canRetry: true }} {...actions} />);
  await blocked(text.check, actions.onCheck); await blocked(text.retry, actions.onRetry); expect(button(text.back)).toBeEnabled();
});

it('does not reset a generation confirmation during waiting or automatically generate afterward', async () => {
  mockWaiting = false;
  const text = storyGenerationCopy.en, actions = { onGenerate: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn(),
    onReviewMemories: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const props = { language: 'en' as const, storyLanguage: 'en' as const, title: project.title,
    state: { phase: 'ready' as const, draft, verification: null, canRetry: false }, ...actions };
  const view = await render(<StoryDraftScreen {...props} />); await fireEvent.press(button(text.generateAgain));
  mockWaiting = true; await view.rerender(<StoryDraftScreen {...props} />);
  await blocked(text.confirm, actions.onGenerate); await blocked(text.refresh, actions.onRefresh); expect(button(text.cancel)).toBeEnabled();
  mockWaiting = false; await view.rerender(<StoryDraftScreen {...props} />); expect(actions.onGenerate).not.toHaveBeenCalled();
  await fireEvent.press(button(text.confirm)); expect(actions.onGenerate).toHaveBeenCalledTimes(1);
});

it('preserves locally browsed generations while disabling server opening and pagination', async () => {
  const text = generationBrowserCopy.en, actions = { onOpen: jest.fn(), onLoadMore: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  await render(<GenerationBrowserScreen language="en" storyLanguage="en" title={project.title} selectedDraftId={draft.draft_id}
    state={{ phase: 'ready', items: [draft, { ...draft, draft_id: '20000000-0000-4000-8000-000000000002', version: 2 }], hasMore: true }} {...actions} />);
  await blocked(text.open, actions.onOpen); await blocked(text.more, actions.onLoadMore); await blocked(text.refresh, actions.onRefresh);
  expect(button(text.next)).toBeEnabled(); await fireEvent.press(button(text.next)); expect(screen.getByText(text.generation + ': 2')).toBeOnTheScreen();
});

it('keeps original wording disclosure available while disabling revision-history requests', async () => {
  const text = draftEditingCopy.en, onLoadMore = jest.fn(), onRefresh = jest.fn();
  await render(<DraftHistoryScreen language="en" storyLanguage="en" title={project.title}
    state={{ phase: 'ready', draft, items: [], hasMore: true }} onLoadMore={onLoadMore} onRefresh={onRefresh} onBack={jest.fn()} onSignOut={jest.fn()} />);
  await blocked(text.loadMore, onLoadMore); await blocked(text.refresh, onRefresh); await fireEvent.press(button(text.showOriginal));
  expect(screen.getByText(draft.original_content)).toBeOnTheScreen(); expect(button(text.hideOriginal)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('blocks PDF creation/download but allows an already downloaded private file to be shared in %s', async language => {
  const text = exportCopy[language], actions = { onPrepare: jest.fn(), onShare: jest.fn(), onDownload: jest.fn(), onLoadMore: jest.fn(),
    onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  await render(<StoryExportsScreen language={language} storyLanguage="en" title={project.title}
    state={{ phase: 'ready', draft, items: [pdf], hasMore: true, fileReady: true, prepared: pdf }} {...actions} />);
  await blocked(text.prepare, actions.onPrepare); await blocked(text.refresh, actions.onRefresh); await fireEvent.press(button(text.history));
  await blocked(text.open, actions.onDownload); await blocked(text.loadMore, actions.onLoadMore);
  expect(button(text.back)).toBeEnabled(); await fireEvent.press(button(text.share)); expect(actions.onShare).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('preserves memory corrections and source disclosure while Save waits in %s', async language => {
  const text = memoryReviewCopy[language], onSave = jest.fn(), onRefresh = jest.fn();
  const message = { id: source.transcript_id, session_id: source.session_id, sequence: 1, role: 'user' as const,
    language: 'en' as const, text: 'I lived in Malmö.', created_at: project.created_at };
  const memory = { id: '60000000-0000-4000-8000-000000000001', project_id: project.id, session_id: source.session_id,
    source_message_id: message.id, fact_type: 'event' as const, value: 'Malmö', evidence: message.text, year: null,
    slot: 'location', uncertain: false, status: 'pending' as const, corrected_value: null, version: 1,
    created_at: project.created_at, updated_at: project.updated_at };
  const props = { language, title: project.title, state: { phase: 'ready' as const, memories: [memory], sources: [message],
    clarifications: [], complete: true }, onSave, onRefresh, onBack: jest.fn(), onSignOut: jest.fn() };
  const view = await render(<MemoryReviewScreen {...props} />); await fireEvent.press(screen.getByRole('radio', { name: text.correct }));
  await fireEvent.changeText(screen.getByLabelText(text.correctionLabel), 'Stockholm');
  await blocked(text.save, onSave); await blocked(text.refresh, onRefresh); await fireEvent.press(button(text.showSource));
  expect(button(text.hideSource)).toBeEnabled(); expect(screen.getByLabelText(text.correctionLabel).props.value).toBe('Stockholm');
  mockWaiting = false; await view.rerender(<MemoryReviewScreen {...props} />); expect(onSave).not.toHaveBeenCalled();
  await fireEvent.press(button(text.save)); expect(onSave).toHaveBeenCalledWith(memory, 'confirmed', 'Stockholm');
});
