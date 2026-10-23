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
function blocked(label: string, callback: jest.Mock) {
  expect(button(label)).toBeDisabled(); fireEvent.press(button(label)); fireEvent.press(button(label));
  expect(callback).not.toHaveBeenCalled();
}

it.each(['en', 'sv'] as const)('preserves a new story form and requires an explicit submit after waiting in %s', language => {
  const onSubmit = jest.fn(), onBack = jest.fn(), onSignOut = jest.fn(), text = createStoryCopy[language];
  const props = { language, state: { status: 'idle' as const }, serviceAvailable: true, onSubmit, onBack, onSignOut };
  const view = render(<CreateStoryScreen {...props} />);
  fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'A fictional summer');
  fireEvent.press(screen.getByRole('radio', { name: text.swedish }));
  expect(screen.getByLabelText(text.titleLabel).props.editable).toBe(true);
  blocked(text.create, onSubmit);
  mockWaiting = false; view.rerender(<CreateStoryScreen {...props} />);
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('A fictional summer');
  expect(onSubmit).not.toHaveBeenCalled(); fireEvent.press(button(text.create)); fireEvent.press(button(text.create));
  expect(onSubmit).toHaveBeenCalledTimes(1); expect(onSubmit).toHaveBeenCalledWith({ title: 'A fictional summer', language: 'sv' });
});

it.each(['en', 'sv'] as const)('keeps project metadata editable while only Save waits in %s', language => {
  const onSubmit = jest.fn(), text = storyDetailsCopy[language];
  render(<EditStoryScreen language={language} project={project} state={{ status: 'idle' }}
    onSubmit={onSubmit} onBack={jest.fn()} onSignOut={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'Changed fictional title');
  fireEvent.changeText(screen.getByLabelText(text.descriptionLabel), 'Changed description');
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('Changed fictional title');
  expect(screen.getByLabelText(text.descriptionLabel).props.editable).toBe(true); blocked(text.save, onSubmit);
  expect(button(text.done)).toBeEnabled(); expect(button(text.cancel)).toBeEnabled(); expect(button(text.signOut)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('disables dashboard Refresh while leaving local navigation and Sign Out usable in %s', language => {
  const onRefresh = jest.fn(), onCreateStory = jest.fn(), text = storiesCopy[language];
  render(<MyStoriesScreen language={language} user={{ id: 'fictional-user', email: 'fictional@example.test' }}
    state={{ status: 'ready', projects: [project] }} onRefresh={onRefresh} onCreateStory={onCreateStory} onSignOut={jest.fn()} />);
  blocked(text.refresh, onRefresh); expect(button(text.signOut)).toBeEnabled(); fireEvent.press(button(text.createStory));
  expect(onCreateStory).toHaveBeenCalledTimes(1);
});

it('keeps details editing and Back available while disabling Reload', () => {
  const onRefresh = jest.fn(), text = storyDetailsCopy.en;
  render(<StoryDetailsScreen language="en" state={{ status: 'ready', project }} onRefresh={onRefresh}
    onEdit={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} />);
  blocked(text.refresh, onRefresh); expect(button(text.edit)).toBeEnabled(); expect(button(text.back)).toBeEnabled();
});

it('disables uncertain session checks without disabling leaving the session', () => {
  const onCheck = jest.fn(), text = conversationCopy.en;
  render(<ConversationScreen language="en" state={{ status: 'error', error: 'network', reconcile: true }}
    onCheck={onCheck} onBack={jest.fn()} onSignOut={jest.fn()} />);
  blocked(text.check, onCheck); expect(button(text.back)).toBeEnabled(); expect(button(text.signOut)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('holds upload/history requests but preserves consent and recording controls in %s', language => {
  const onUpload = jest.fn(), onRetryHistory = jest.fn(), text = audioCopy[language];
  const actions = { onStart: jest.fn(), onStop: jest.fn(), onConsentChange: jest.fn(), onUpload, onDiscard: jest.fn(), onRetryHistory };
  const view = render(<RecordingPanel language={language} state={{ phase: 'ready', durationMs: 8000, consent: true,
    transcripts: [], hasRecording: true, historyFailed: true }} {...actions} />);
  blocked(text.upload, onUpload); blocked(text.retryHistory, onRetryHistory);
  expect(screen.getByRole('checkbox', { name: text.consent })).toBeEnabled(); expect(button(text.discard)).toBeEnabled();
  view.rerender(<RecordingPanel language={language} state={{ phase: 'recording', durationMs: 8000, consent: false, transcripts: [] }} {...actions} />);
  fireEvent.press(button(text.stop)); expect(actions.onStop).toHaveBeenCalledTimes(1); expect(onUpload).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('preserves transcript selection but disables processing, refresh and uncertain retry in %s', language => {
  const text = transcriptConversationCopy[language], actions = { onSelect: jest.fn(), onProcess: jest.fn(), onReconcile: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn() };
  const state = { phase: 'ready' as const, messages: [], processedIds: [], complete: true, canRetry: false, selectedId: source.transcript_id };
  const view = render(<ConversationPanel language={language} state={state} transcripts={[source]} {...actions} />);
  blocked(text.process, actions.onProcess); blocked(text.refresh, actions.onRefresh);
  expect(screen.getByRole('radio', { name: text.select + ' 1' })).toBeEnabled();
  view.rerender(<ConversationPanel language={language} state={{ ...state, phase: 'uncertain', canRetry: true }} transcripts={[source]} {...actions} />);
  blocked(text.reconcile, actions.onReconcile); blocked(text.retry, actions.onRetry);
});

it.each(['en', 'sv'] as const)('keeps draft wording editable and does not save automatically when waiting ends in %s', language => {
  const text = draftEditingCopy[language], actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
    onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const props = { language, storyLanguage: 'en' as const, title: project.title,
    state: { phase: 'editing' as const, draft, text: draft.content, canRetry: false, dirty: true }, ...actions };
  const view = render(<DraftEditorScreen {...props} />); blocked(text.save, actions.onSave);
  expect(screen.getByLabelText(text.field).props.editable).toBe(true); expect(button(text.done)).toBeEnabled();
  mockWaiting = false; view.rerender(<DraftEditorScreen {...props} />); expect(actions.onSave).not.toHaveBeenCalled();
  fireEvent.press(button(text.save)); expect(actions.onSave).toHaveBeenCalledTimes(1);
});

it('disables uncertain draft reconciliation and retry until waiting ends', () => {
  const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(), onUseLatest: jest.fn(),
    onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() }, text = draftEditingCopy.en;
  render(<DraftEditorScreen language="en" storyLanguage="en" title={project.title}
    state={{ phase: 'uncertain', draft, text: draft.content, dirty: true, canRetry: true }} {...actions} />);
  blocked(text.check, actions.onCheck); blocked(text.retry, actions.onRetry); expect(button(text.back)).toBeEnabled();
});

it('does not reset a generation confirmation during waiting or automatically generate afterward', () => {
  mockWaiting = false;
  const text = storyGenerationCopy.en, actions = { onGenerate: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn(),
    onReviewMemories: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const props = { language: 'en' as const, storyLanguage: 'en' as const, title: project.title,
    state: { phase: 'ready' as const, draft, verification: null, canRetry: false }, ...actions };
  const view = render(<StoryDraftScreen {...props} />); fireEvent.press(button(text.generateAgain));
  mockWaiting = true; view.rerender(<StoryDraftScreen {...props} />);
  blocked(text.confirm, actions.onGenerate); blocked(text.refresh, actions.onRefresh); expect(button(text.cancel)).toBeEnabled();
  mockWaiting = false; view.rerender(<StoryDraftScreen {...props} />); expect(actions.onGenerate).not.toHaveBeenCalled();
  fireEvent.press(button(text.confirm)); expect(actions.onGenerate).toHaveBeenCalledTimes(1);
});

it('preserves locally browsed generations while disabling server opening and pagination', () => {
  const text = generationBrowserCopy.en, actions = { onOpen: jest.fn(), onLoadMore: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  render(<GenerationBrowserScreen language="en" storyLanguage="en" title={project.title} selectedDraftId={draft.draft_id}
    state={{ phase: 'ready', items: [draft, { ...draft, draft_id: '20000000-0000-4000-8000-000000000002', version: 2 }], hasMore: true }} {...actions} />);
  blocked(text.open, actions.onOpen); blocked(text.more, actions.onLoadMore); blocked(text.refresh, actions.onRefresh);
  expect(button(text.next)).toBeEnabled(); fireEvent.press(button(text.next)); expect(screen.getByText(text.generation + ': 2')).toBeOnTheScreen();
});

it('keeps original wording disclosure available while disabling revision-history requests', () => {
  const text = draftEditingCopy.en, onLoadMore = jest.fn(), onRefresh = jest.fn();
  render(<DraftHistoryScreen language="en" storyLanguage="en" title={project.title}
    state={{ phase: 'ready', draft, items: [], hasMore: true }} onLoadMore={onLoadMore} onRefresh={onRefresh} onBack={jest.fn()} onSignOut={jest.fn()} />);
  blocked(text.loadMore, onLoadMore); blocked(text.refresh, onRefresh); fireEvent.press(button(text.showOriginal));
  expect(screen.getByText(draft.original_content)).toBeOnTheScreen(); expect(button(text.hideOriginal)).toBeEnabled();
});

it.each(['en', 'sv'] as const)('blocks PDF creation/download but allows an already downloaded private file to be shared in %s', language => {
  const text = exportCopy[language], actions = { onPrepare: jest.fn(), onShare: jest.fn(), onDownload: jest.fn(), onLoadMore: jest.fn(),
    onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  render(<StoryExportsScreen language={language} storyLanguage="en" title={project.title}
    state={{ phase: 'ready', draft, items: [pdf], hasMore: true, fileReady: true, prepared: pdf }} {...actions} />);
  blocked(text.prepare, actions.onPrepare); blocked(text.refresh, actions.onRefresh); fireEvent.press(button(text.history));
  blocked(text.open, actions.onDownload); blocked(text.loadMore, actions.onLoadMore);
  expect(button(text.back)).toBeEnabled(); fireEvent.press(button(text.share)); expect(actions.onShare).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('preserves memory corrections and source disclosure while Save waits in %s', language => {
  const text = memoryReviewCopy[language], onSave = jest.fn(), onRefresh = jest.fn();
  const message = { id: source.transcript_id, session_id: source.session_id, sequence: 1, role: 'user' as const,
    language: 'en' as const, text: 'I lived in Malmö.', created_at: project.created_at };
  const memory = { id: '60000000-0000-4000-8000-000000000001', project_id: project.id, session_id: source.session_id,
    source_message_id: message.id, fact_type: 'event' as const, value: 'Malmö', evidence: message.text, year: null,
    slot: 'location', uncertain: false, status: 'pending' as const, corrected_value: null, version: 1,
    created_at: project.created_at, updated_at: project.updated_at };
  const props = { language, title: project.title, state: { phase: 'ready' as const, memories: [memory], sources: [message],
    clarifications: [], complete: true }, onSave, onRefresh, onBack: jest.fn(), onSignOut: jest.fn() };
  const view = render(<MemoryReviewScreen {...props} />); fireEvent.press(screen.getByRole('radio', { name: text.correct }));
  fireEvent.changeText(screen.getByLabelText(text.correctionLabel), 'Stockholm');
  blocked(text.save, onSave); blocked(text.refresh, onRefresh); fireEvent.press(button(text.showSource));
  expect(button(text.hideSource)).toBeEnabled(); expect(screen.getByLabelText(text.correctionLabel).props.value).toBe('Stockholm');
  mockWaiting = false; view.rerender(<MemoryReviewScreen {...props} />); expect(onSave).not.toHaveBeenCalled();
  fireEvent.press(button(text.save)); expect(onSave).toHaveBeenCalledWith(memory, 'confirmed', 'Stockholm');
});
