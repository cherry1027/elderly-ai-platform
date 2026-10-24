import { getComponent } from './component-probe';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MemoryReview } from '../src/memories/MemoryReview';
import { MemoryReviewScreen } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { listMemoryReview, patchMemory, type MemoryFact, type MemoryClarification } from '../src/api/memory-review';
import { listConversationMessages, type ConversationMessage } from '../src/api/conversation-messages';
import { generateStoryDraft } from '../src/api/story-drafts';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import { readStoryPreviewEnabled } from '../src/development/story-preview-config';
import type { Language } from '../src/i18n';


jest.mock('../src/memories/MemoryReviewScreen', () => {
  const actual = jest.requireActual<typeof import('../src/memories/MemoryReviewScreen')>('../src/memories/MemoryReviewScreen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, MemoryReviewScreen: observeComponent(actual.MemoryReviewScreen) };
});

jest.mock('../src/api/memory-review', () => ({ ...jest.requireActual('../src/api/memory-review'),
  listMemoryReview: jest.fn(), patchMemory: jest.fn() }));
jest.mock('../src/api/conversation-messages', () => ({ ...jest.requireActual('../src/api/conversation-messages'),
  listConversationMessages: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'), generateStoryDraft: jest.fn() }));
jest.mock('../src/development/story-preview-config', () => ({ readStoryPreviewEnabled: jest.fn(() => false) }));

const ownerId = 'account-a';
const projectId = '51000000-0000-4000-8000-000000000001';
const sessionId = '52000000-0000-4000-8000-000000000001';
const factId = '53000000-0000-4000-8000-000000000001';
const otherFactId = '53000000-0000-4000-8000-000000000002';
const sourceId = '54000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T10:00:00Z';
const evidence = (language: Language) => language === 'sv' ? 'Jag flyttade till Malmö 1974.' : 'I moved to Malmö in 1974.';
const fact = (language: Language, overrides: Partial<MemoryFact> = {}): MemoryFact => ({
  id: factId, project_id: projectId, session_id: sessionId, source_message_id: sourceId,
  fact_type: 'event', value: 'Malmö', evidence: evidence(language), year: 1974, slot: 'move',
  uncertain: false, status: 'pending', corrected_value: null, version: 1, created_at: stamp, updated_at: stamp, ...overrides,
});
const source = (language: Language, extra = ''): ConversationMessage => ({ id: sourceId, session_id: sessionId,
  role: 'user', text: `${SIMULATED_TRANSCRIPT_NOTICE}\n${evidence(language)}${extra}`, language,
  sequence: 1, created_at: stamp });
const question: MemoryClarification = { id: '55000000-0000-4000-8000-000000000001', fact_id: otherFactId,
  session_id: sessionId, conflicts_with_fact_id: factId, question: 'Which fictional year is correct?',
  status: 'open', resolution: null, created_at: stamp, resolved_at: null };
const token = jest.fn(async (_owner: string) => 'synthetic-user-access-token');
const back = jest.fn(); const signOut = jest.fn();
function presentation() { return getComponent(MemoryReviewScreen).props; }
async function open(language: Language) {
  return await render(<MemoryReview language={language} title="A fictional saved story" ownerId={ownerId}
    projectId={projectId} sessionId={sessionId} sessionLanguage={language} baseUrl="http://192.168.20.30:8000"
    getAccessToken={token} onBack={back} onSignOut={signOut} />);
}
beforeEach(() => {
  jest.mocked(listMemoryReview).mockReset(); jest.mocked(patchMemory).mockReset();
  jest.mocked(listConversationMessages).mockReset(); jest.mocked(generateStoryDraft).mockClear();
  jest.mocked(readStoryPreviewEnabled).mockReturnValue(false); token.mockClear(); back.mockClear(); signOut.mockClear();
});

it.each<Language>(['en', 'sv'])('supports the real %s memory-correction UI without changing original evidence or generating prose', async language => {
  const text = memoryReviewCopy[language]; const original = fact(language), originalSource = source(language);
  const saved = fact(language, { status: 'confirmed', corrected_value: '1975', version: 2 });
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [original], clarifications: [], complete: true })
    .mockResolvedValue({ memories: [saved], clarifications: [], complete: true });
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [originalSource], complete: true });
  jest.mocked(patchMemory).mockResolvedValue(saved);
  await open(language); await screen.findByRole('radio', { name: text.correct });
  expect(screen.getByText(text.simulated)).toBeOnTheScreen(); expect(patchMemory).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('radio', { name: text.correct }));
  await fireEvent.changeText(screen.getByLabelText(text.correctionLabel), '1975');
  expect(patchMemory).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.save }));
  await screen.findByText(text.saved);
  expect(patchMemory).toHaveBeenCalledTimes(1);
  const request = jest.mocked(patchMemory).mock.calls[0][0];
  expect(request).toMatchObject({ projectId, sessionId, expectedLanguage: language,
    memory: original, input: { status: 'confirmed', expected_version: 1, corrected_value: '1975' } });
  expect(request.input).not.toHaveProperty('value'); expect(request.input).not.toHaveProperty('year');
  await request.getAccessToken(); expect(token).toHaveBeenLastCalledWith(ownerId);
  expect(presentation().state.memories).toEqual([saved]); expect(presentation().state.sources).toEqual([originalSource]);
  expect(presentation().state.memories[0]).toMatchObject({ value: 'Malmö', year: 1974,
    evidence: evidence(language), corrected_value: '1975', source_message_id: sourceId, version: 2 });
  expect(screen.getByText('1975')).toBeOnTheScreen(); expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.showSource }));
  expect(screen.getByText(originalSource.text)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.back })); expect(back).toHaveBeenCalledTimes(1);
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('does not silently confirm or reject a different conflicting candidate when the selected memory is corrected', async () => {
  const text = memoryReviewCopy.en; const original = fact('en');
  const other = fact('en', { id: otherFactId, evidence: 'I moved to Malmö in 1976.', year: 1976 });
  const saved = fact('en', { status: 'confirmed', corrected_value: '1975', version: 2 });
  const originalSource = source('en', ' I moved to Malmö in 1976.');
  jest.mocked(listMemoryReview).mockResolvedValueOnce({ memories: [original, other], clarifications: [question], complete: true })
    .mockResolvedValue({ memories: [saved, other], clarifications: [question], complete: true });
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [originalSource], complete: true });
  jest.mocked(patchMemory).mockResolvedValue(saved);
  await open('en'); await screen.findByRole('radio', { name: text.correct });
  await fireEvent.press(screen.getByRole('radio', { name: text.correct }));
  await fireEvent.changeText(screen.getByLabelText(text.correctionLabel), '1975');
  await fireEvent.press(screen.getByRole('button', { name: text.save })); await screen.findByText(text.saved);
  expect(presentation().state.memories).toEqual([saved, other]); expect(presentation().state.clarifications).toEqual([question]);
  expect(patchMemory).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: text.next }));
  await waitFor(() => expect(screen.getByText(question.question)).toBeOnTheScreen());
  expect(screen.getByText(`${text.status}: ${text.statuses.pending}`)).toBeOnTheScreen();
  expect(screen.getByText(text.questionHelp)).toBeOnTheScreen();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('leaves candidate review read-only until an explicit choice is saved', async () => {
  jest.mocked(listMemoryReview).mockResolvedValue({ memories: [fact('en')], clarifications: [], complete: true });
  jest.mocked(listConversationMessages).mockResolvedValue({ messages: [source('en')], complete: true });
  await open('en'); await screen.findByRole('radio', { name: memoryReviewCopy.en.confirm });
  await fireEvent.press(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm }));
  expect(patchMemory).not.toHaveBeenCalled();
  await act(() => presentation().onBack());
  expect(back).toHaveBeenCalledTimes(1); expect(patchMemory).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
