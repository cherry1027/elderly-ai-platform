import { nativeNodes, nativeText } from './native-tree';
import { useState } from 'react';
import * as backoff from '../src/api/ApiBackoff';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Native from 'react-native';
import { Text } from 'react-native';
import { LargeButton } from '../src/components/LargeButton';
import { AutobiographyContent, MemoriesContent, storyContentCopy, type AutobiographyContentProps } from '../src/real-ai/StoryContent';
import { realCopy } from '../src/real-ai/copy';
import type { RealMemory } from '../src/real-ai/api';
import type { Language } from '../src/i18n';
import { realDraft, realIds, realMemory } from './real-ai-fixtures';

const noop = () => {};
const first = realMemory({ clarification_question: null });
const reviewed = realMemory({ id: realIds.assistant, value: 'An earlier reviewed memory', evidence: 'Earlier original words.', status: 'confirmed', version: 2, clarification_question: null });
function MemoryHarness({ language, memories, onReview, onShareMemory = noop, onBeginCorrection, onOpenStory }: {
  language: Language; memories: RealMemory[]; onReview: (memory: RealMemory, status: 'confirmed' | 'rejected') => void; onShareMemory?: () => void; onBeginCorrection?: (memory: RealMemory) => void; onOpenStory?: () => void;
}) {
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  return <MemoriesContent language={language} storyLanguage={language} memories={memories} corrections={corrections}
    blocked={false} busy={false} onCorrection={(id, value) => setCorrections(before => ({ ...before, [id]: value }))}
    onReview={onReview} onShareMemory={onShareMemory} onBeginCorrection={onBeginCorrection} onOpenStory={onOpenStory} />;
}
function bookProps(language: Language = 'en'): AutobiographyContentProps {
  return {
    language, storyLanguage: language, draft: realDraft(), drafts: [realDraft()], memories: [reviewed],
    editor: null, history: null, exports: null, blocked: false, busy: false, ambiguousEdit: false, usageBlocked: false,
    writingAvailable: true, privacyReady: true, privacyFailed: false, generationControls: <Text allowFontScaling>Existing deliberate generation controls</Text>,
    onEdit: jest.fn(), onChangeEditor: jest.fn(), onSave: jest.fn(), onCancel: jest.fn(), onSelectDraft: jest.fn(),
    onLoadHistory: jest.fn(), onLoadExports: jest.fn(), onExport: jest.fn(), onDownloadExport: jest.fn(),
    onReviewMemories: jest.fn(), onShareMemory: jest.fn(),
  };
}
const panel = (label: string) => within(screen.getByRole('button', { name: label }).parent!);
afterEach(() => { jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each(['en', 'sv'] as const)('prioritizes pending memories and keeps actual reviewed decisions accessible in %s', async language => {
  const t = realCopy[language], copy = storyContentCopy[language], review = jest.fn();
  await render(<MemoryHarness language={language} memories={[reviewed, first]} onReview={review} />);
  expect(screen.getByText(first.value)).toBeOnTheScreen();
  expect(screen.queryByText(reviewed.value)).toBeNull();
  expect(screen.getByRole('button', { name: t.confirm })).toHaveStyle({ minHeight: 56 });
  expect(screen.getByRole('button', { name: t.correctAction })).toHaveStyle({ minHeight: 56 });
  expect(screen.getByRole('button', { name: t.reject })).toHaveStyle({ minHeight: 56 });
  await fireEvent.press(screen.getByRole('button', { name: copy.reviewed }));
  expect(screen.getByText(reviewed.value)).toBeOnTheScreen(); expect(screen.getByText(copy.confirmed)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: copy.changeDecision }));
  const reviewedCard = within(screen.getByText(reviewed.value).parent!);
  expect(reviewedCard.queryByRole('button', { name: t.confirm })).toBeNull();
  await fireEvent.press(reviewedCard.getByRole('button', { name: t.reject }));
  expect(review).toHaveBeenCalledWith(reviewed, 'rejected');
});
it.each(['en', 'sv'] as const)('retains correction text through details toggles and uses explicit Save correction in %s', async language => {
  const t = realCopy[language], copy = storyContentCopy[language], review = jest.fn();
  await render(<MemoryHarness language={language} memories={[first]} onReview={review} />);
  await fireEvent.press(screen.getByRole('button', { name: t.correctAction }));
  expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  const input = screen.getByLabelText(t.correct);
  expect(input.props.allowFontScaling).toBe(true); expect(input.props.multiline).toBe(true);
  expect(screen.getByRole('button', { name: copy.saveCorrection })).toBeDisabled();
  await fireEvent.changeText(input, 'My exact corrected memory.');
  for (const label of [t.seeOriginal, t.correctAction, t.seeOriginal, t.correctAction]) await fireEvent.press(screen.getByRole('button', { name: label }));
  expect(screen.getByLabelText(t.correct).props.value).toBe('My exact corrected memory.');
  expect(screen.queryByText(first.evidence)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t.seeOriginal }));
  expect(screen.getByText(first.evidence)).toHaveProp('selectable', true);
  await fireEvent.press(screen.getByRole('button', { name: copy.saveCorrection }));
  expect(review).toHaveBeenCalledWith(first, 'confirmed');
});
it.each(['en', 'sv'] as const)('shows a saved decision and story action only after verified confirmation in %s', async language => {
  const review = jest.fn(), openStory = jest.fn(), copy = storyContentCopy[language], t = realCopy[language];
  const pending = { ...first, clarification_question: 'Where did you live?' };
  const view = await render(<MemoryHarness language={language} memories={[pending, reviewed]} onReview={review} onOpenStory={openStory} />);
  await fireEvent.press(screen.getByRole('button', { name: t.confirm }));
  expect(screen.getByText(pending.value)).toBeOnTheScreen();
  expect(screen.getByText(t.pendingStatus)).toBeOnTheScreen();
  expect(screen.queryByText(copy.memorySaved)).toBeNull();
  expect(screen.queryByRole('button', { name: copy.startStory })).toBeNull();
  await view.rerender(<MemoryHarness language={language} memories={[{ ...pending, status: 'confirmed', version: 2, clarification_question: null }, reviewed]} onReview={review} onOpenStory={openStory} />);
  expect(screen.queryByText(t.pendingStatus)).toBeNull();
  expect(screen.getByText(pending.value)).toBeOnTheScreen();
  expect(screen.getByText(copy.memorySaved)).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(screen.getByText(copy.reviewProgress(2))).toBeOnTheScreen();
  expect(screen.getByText(copy.allReviewed)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: copy.reviewed }).props.accessibilityState.expanded).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: copy.startStory }));
  expect(openStory).toHaveBeenCalledTimes(1);
});
it.each(['en', 'sv'] as const)('offers a clear existing destination for empty memories in %s', async language => {
  const share = jest.fn();
  await render(<MemoryHarness language={language} memories={[]} onReview={noop} onShareMemory={share} />);
  await fireEvent.press(screen.getByRole('button', { name: storyContentCopy[language].shareMemory })); expect(share).toHaveBeenCalledTimes(1);
});
it('keeps a newly saved memory visible beside the remaining questions', async () => {
  const review = jest.fn(), copy = storyContentCopy.en, t = realCopy.en;
  const next = realMemory({ id: realIds.draft, value: 'Another pending memory' });
  const view = await render(<MemoryHarness language="en" memories={[first, next]} onReview={review} />);
  await fireEvent.press(within(screen.getByText(first.value).parent!).getByRole('button', { name: t.confirm }));
  await view.rerender(<MemoryHarness language="en" memories={[{ ...first, status: 'confirmed', version: 2 }, next]} onReview={review} />);
  expect(within(screen.getByText(first.value).parent!).getByText(copy.confirmed)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: copy.reviewed })).toBeNull();
  expect(screen.getByText(next.value)).toBeOnTheScreen();
});
it.each(['en', 'sv'] as const)('puts Edit and PDF before prose and keeps technical information secondary in %s', async language => {
  const props = bookProps(language), t = realCopy[language], copy = storyContentCopy[language];
  const older = realDraft({ draft_id: realIds.assistant, version: 2, revision: 3 }); props.drafts.push(older);
  await render(<AutobiographyContent {...props} />);
  const texts = nativeNodes('text').map(nativeText);
  expect(texts.indexOf(t.edit)).toBeLessThan(texts.indexOf(props.draft!.content));
  expect(texts.indexOf(t.export)).toBeLessThan(texts.indexOf(props.draft!.content));
  expect(screen.getByText(props.draft!.content)).toHaveProp('selectable', true);
  expect(screen.getByText(t.reviewDraft)).toBeOnTheScreen();
  expect(screen.queryByText(t.modelReview)).toBeNull();
  expect(screen.queryByText(props.draft!.source_memories[0].evidence)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t.edit })); expect(props.onEdit).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: t.export })); expect(props.onExport).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(copy.pdfShort)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: copy.pdfDetails })); expect(screen.getByText(t.pdfNotice)).toBeOnTheScreen();
  expect(screen.getByText(copy.pdfShort)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: copy.aboutVersion }));
  expect(screen.getByText(t.modelReview)).toBeOnTheScreen();
  expect(screen.getByText(props.draft!.source_memories[0].evidence)).toHaveProp('selectable', true);
  expect(screen.queryByRole('button', { name: `${t.version} 2 · ${t.revision} 3` })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  await fireEvent.press(screen.getByRole('button', { name: `${t.version} 2 · ${t.revision} 3` }));
  expect(props.onSelectDraft).toHaveBeenCalledWith(older);
});
it.each(['en', 'sv'] as const)('loads read-only history/PDF lists on first deliberate expansion and retains results in %s', async language => {
  const props = bookProps(language), t = realCopy[language];
  const view = await render(<AutobiographyContent {...props} />);
  expect(props.onLoadHistory).not.toHaveBeenCalled(); expect(props.onLoadExports).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: t.historySection })); expect(props.onLoadHistory).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} history={[]} />);
  expect(screen.getByText(t.noHistory)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  expect(props.onLoadHistory).toHaveBeenCalledTimes(1); expect(screen.getByText(t.noHistory)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t.pdfVersions })); expect(props.onLoadExports).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} history={[]} exports={[]} />);
  expect(screen.getByText(t.noExports)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t.pdfVersions }));
  await fireEvent.press(screen.getByRole('button', { name: t.pdfVersions }));
  expect(props.onLoadExports).toHaveBeenCalledTimes(1); expect(screen.getByText(t.noExports)).toBeOnTheScreen();
});
it('does not retry a failed read on toggles and allows only deliberate idle retry', async () => {
  const props = bookProps(), t = realCopy.en, copy = storyContentCopy.en;
  const view = await render(<AutobiographyContent {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  await view.rerender(<AutobiographyContent {...props} busy blocked />);
  expect(panel(t.historySection).queryByRole('button', { name: copy.tryAgain })).toBeNull();
  await view.rerender(<AutobiographyContent {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  expect(props.onLoadHistory).toHaveBeenCalledTimes(1);
  await fireEvent.press(panel(t.historySection).getByRole('button', { name: copy.tryAgain })); expect(props.onLoadHistory).toHaveBeenCalledTimes(2);
});
it('retains editor text during detail toggles and reuses Save/Cancel handlers', async () => {
  const props = bookProps(), t = realCopy.en;
  await render(<AutobiographyContent {...props} editor={'Unsaved text.\nSecond line.'} />);
  await fireEvent.press(screen.getByRole('button', { name: storyContentCopy.en.aboutVersion }));
  await fireEvent.press(screen.getByRole('button', { name: storyContentCopy.en.aboutVersion }));
  expect(screen.getByLabelText(t.editor).props.value).toBe('Unsaved text.\nSecond line.');
  await fireEvent.changeText(screen.getByLabelText(t.editor), 'New draft wording.'); expect(props.onChangeEditor).toHaveBeenCalledWith('New draft wording.');
  await fireEvent.press(screen.getByRole('button', { name: t.save })); expect(props.onSave).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: t.cancel })); expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: t.export })).toBeNull();
});
it('respects existing write/PDF disable flags and never starts generation from expansion', async () => {
  const props = bookProps(), t = realCopy.en, generate = jest.fn();
  const view = await render(<AutobiographyContent {...props} privacyFailed generationControls={<LargeButton language="en" label="Deliberate generation" onPress={generate} />} />);
  expect(screen.getByRole('button', { name: t.export })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: t.createVersion })); expect(generate).not.toHaveBeenCalled();
  await view.rerender(<AutobiographyContent {...props} blocked />);
  expect(screen.getByRole('button', { name: t.edit })).toBeDisabled(); expect(screen.getByRole('button', { name: t.export })).toBeDisabled();
});
it.each(['en', 'sv'] as const)('gives one useful next step instead of disabled creation for empty work in %s', async language => {
  const props = bookProps(language), copy = storyContentCopy[language], t = realCopy[language];
  const view = await render(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[]} />);
  await fireEvent.press(screen.getByRole('button', { name: copy.shareMemory })); expect(props.onShareMemory).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[first]} />);
  await fireEvent.press(screen.getByRole('button', { name: copy.reviewFirst })); expect(props.onReviewMemories).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} draft={null} drafts={[]} writingAvailable={false} />);
  expect(screen.getByText(copy.aiUnavailable)).toBeOnTheScreen(); expect(screen.queryByRole('button', { name: t.generate })).toBeNull();
});
it('honors read cooldowns while keeping already loaded history readable', async () => {
  const props = bookProps(), t = realCopy.en;
  const cooldown = jest.spyOn(backoff, 'useApiBackoff').mockReturnValue({ waiting: true, expired: false, visible: true, language: 'en' });
  const view = await render(<AutobiographyContent {...props} />);
  expect(screen.getByRole('button', { name: t.historySection })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: t.historySection })); expect(props.onLoadHistory).not.toHaveBeenCalled();
  cooldown.mockReturnValue({ waiting: false, expired: false, visible: true, language: 'en' });
  await view.rerender(<AutobiographyContent {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: t.historySection })); expect(props.onLoadHistory).toHaveBeenCalledTimes(1);
  cooldown.mockReturnValue({ waiting: true, expired: false, visible: true, language: 'en' });
  await view.rerender(<AutobiographyContent {...props} history={[]} />);
  expect(screen.getByRole('button', { name: t.historySection })).toBeEnabled();
  expect(screen.getByText(t.noHistory)).toBeOnTheScreen();
});
it('offers review instead of an unexplained disabled new-version action', async () => {
  const props = bookProps();
  await render(<AutobiographyContent {...props} memories={[first]} />);
  await fireEvent.press(screen.getByRole('button', { name: realCopy.en.createVersion }));
  await fireEvent.press(screen.getByRole('button', { name: storyContentCopy.en.reviewFirst }));
  expect(props.onReviewMemories).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
});

it.each(['en', 'sv'] as const)('waits for memories instead of showing false empty autobiography actions in %s', async language => {
  const props = bookProps(language), t = realCopy[language], copy = storyContentCopy[language];
  const view = await render(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[]} memoriesLoading />);
  expect(screen.getByText(t.loadingMemories)).toBeOnTheScreen();
  expect(screen.queryByText(t.emptyBook)).toBeNull();
  expect(screen.queryByRole('button', { name: copy.shareMemory })).toBeNull();
  expect(screen.queryByRole('button', { name: copy.reviewFirst })).toBeNull();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
  await view.rerender(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[]} memoriesLoading={false} />);
  expect(screen.queryByText(t.loadingMemories)).toBeNull();
  expect(screen.getByRole('button', { name: copy.shareMemory })).toBeOnTheScreen();
});
it.each(['en', 'sv'] as const)('keeps saved prose and primary actions usable while memories load in %s', async language => {
  const props = bookProps(language), t = realCopy[language];
  const view = await render(<AutobiographyContent {...props} memories={[]} memoriesLoading />);
  expect(screen.getByText(props.draft!.content)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: t.createVersion }));
  expect(screen.getByText(t.loadingMemories)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: storyContentCopy[language].reviewFirst })).toBeNull();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
  await view.rerender(<AutobiographyContent {...props} memoriesLoading={false} />);
  expect(screen.getByText('Existing deliberate generation controls')).toBeOnTheScreen();
});
it('shows history and PDF loading independently without blocking saved prose or primary actions', async () => {
  const props = bookProps(), t = realCopy.en, copy = storyContentCopy.en;
  const view = await render(<AutobiographyContent {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  await view.rerender(<AutobiographyContent {...props} historyLoading />);
  expect(panel(t.historySection).getByText(copy.loading)).toBeOnTheScreen();
  expect(panel(t.historySection).queryByRole('button', { name: copy.tryAgain })).toBeNull();
  expect(screen.getByText(props.draft!.content)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: t.pdfVersions }));
  expect(props.onLoadExports).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} history={[]} historyLoading={false} exportsLoading />);
  expect(screen.getByText(t.noHistory)).toBeOnTheScreen();
  expect(panel(t.pdfVersions).getByText(copy.loading)).toBeOnTheScreen();
  expect(panel(t.pdfVersions).queryByRole('button', { name: copy.tryAgain })).toBeNull();
  expect(screen.getByRole('button', { name: t.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
  expect(props.onLoadHistory).toHaveBeenCalledTimes(1); expect(props.onLoadExports).toHaveBeenCalledTimes(1);
});

it('leaves unknown failed memories to the owning error view without false empty or generation guidance', async () => {
  const props = bookProps(), t = realCopy.en, copy = storyContentCopy.en;
  await render(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[]} memoriesUnavailable />);
  expect(screen.queryByText(t.loadingMemories)).toBeNull();
  expect(screen.queryByText(t.emptyBook)).toBeNull();
  expect(screen.queryByRole('button', { name: copy.shareMemory })).toBeNull();
  expect(screen.queryByRole('button', { name: copy.reviewFirst })).toBeNull();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
});
it('keeps saved prose and primary actions available after a memory read failure', async () => {
  const props = bookProps(), t = realCopy.en;
  await render(<AutobiographyContent {...props} memories={[]} memoriesUnavailable />);
  expect(screen.getByText(props.draft!.content)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
  expect(screen.queryByRole('button', { name: t.createVersion })).toBeNull();
  expect(screen.queryByText(t.loadingMemories)).toBeNull();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
});

it('identifies the exact memory version when its correction opens and retains wording and original evidence', async () => {
  const chosen = realMemory({ id: realIds.assistant, value: 'The specific memory to correct', evidence: 'My exact original words for this memory.', version: 7 });
  const begin = jest.fn(), review = jest.fn(), t = realCopy.en;
  await render(<MemoryHarness language="en" memories={[first, chosen]} onReview={review} onBeginCorrection={begin} />);
  const card = within(screen.getByText(chosen.value).parent!);
  expect(begin).not.toHaveBeenCalled();
  await fireEvent.press(card.getByRole('button', { name: t.correctAction }));
  expect(begin).toHaveBeenCalledTimes(1); expect(begin.mock.calls[0][0]).toBe(chosen);
  expect(begin.mock.calls[0][0].version).toBe(7);
  await fireEvent.changeText(card.getByLabelText(t.correct), 'Keep this controlled correction.');
  await fireEvent.press(card.getByRole('button', { name: t.seeOriginal }));
  expect(card.getByText(chosen.evidence)).toHaveProp('selectable', true);
  await fireEvent.press(card.getByRole('button', { name: t.correctAction }));
  expect(begin).toHaveBeenCalledTimes(1);
  await fireEvent.press(card.getByRole('button', { name: t.correctAction }));
  expect(begin).toHaveBeenCalledTimes(2); expect(begin.mock.calls[1][0]).toBe(chosen);
  expect(card.getByLabelText(t.correct).props.value).toBe('Keep this controlled correction.');
  expect(card.getByText(chosen.evidence)).toBeOnTheScreen(); expect(review).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('shows remembered content immediately when no decisions are pending in %s', async language => {
  const t = realCopy[language], copy = storyContentCopy[language], review = jest.fn();
  await render(<MemoryHarness language={language} memories={[reviewed]} onReview={review} />);
  expect(screen.getByText(reviewed.value)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: copy.reviewed }).props.accessibilityState.expanded).toBe(true);
  expect(screen.queryByText(t.reviewNotice)).toBeNull();
  expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  expect(screen.queryByRole('button', { name: t.reject })).toBeNull();
  expect(review).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('keeps uncertainty as the existing question and leaves rejection explicit in %s', async language => {
  const t = realCopy[language], copy = storyContentCopy[language], review = jest.fn();
  const question = realMemory({ clarification_question: 'Which year did you move?', uncertain: true });
  await render(<MemoryHarness language={language} memories={[question]} onReview={review} />);
  expect(screen.getByText(question.clarification_question!)).toBeOnTheScreen();
  expect(screen.getByText(copy.isCorrect)).toBeOnTheScreen();
  expect(screen.getAllByText(t.pendingStatus)).toHaveLength(1);
  expect(screen.queryByText(/confidence|candidate|provider/i)).toBeNull();
  expect(screen.queryByText(question.evidence)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t.reject }));
  expect(review).toHaveBeenCalledWith(question, 'rejected');
});

it.each(['en', 'sv'] as const)('replaces an incomplete legacy question with a clear prompt about the visible memory in %s', async language => {
  const question = realMemory({ clarification_question: 'Year?', uncertain: true });
  await render(<MemoryHarness language={language} memories={[question]} onReview={noop} />);
  expect(screen.getByText(question.value)).toBeOnTheScreen();
  expect(screen.getByText(storyContentCopy[language].isCorrect)).toBeOnTheScreen();
  expect(screen.queryByText(question.clarification_question!)).toBeNull();
});

it('retains known version selection while separate history is loading without starting another read', async () => {
  const props = bookProps(), t = realCopy.en;
  const older = realDraft({ draft_id: realIds.assistant, version: 2, revision: 3 });
  await render(<AutobiographyContent {...props} drafts={[props.draft!, older]} historyLoading />);
  expect(screen.getByRole('button', { name: t.historySection })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: t.historySection }));
  expect(props.onLoadHistory).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: `${t.version} 2 · ${t.revision} 3` }));
  expect(props.onSelectDraft).toHaveBeenCalledWith(older);
  expect(screen.getByText(props.draft!.content)).toBeOnTheScreen();
});

it('keeps memory actions scalable and wrapping with no fixed-height card clipping', async () => {
  jest.spyOn(Native, 'useWindowDimensions').mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 2 });
  const t = realCopy.en;
  await render(<MemoryHarness language="en" memories={[first]} onReview={noop} />);
  const change = screen.getByRole('button', { name: t.correctAction });
  expect(change).toHaveStyle({ minHeight: 56, maxWidth: '100%', flexBasis: 140 });
  expect(change.parent).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
  expect(screen.getByText(t.correctAction)).toHaveProp('allowFontScaling', true);
  expect(screen.getByText(first.value)).toHaveProp('allowFontScaling', true);
  expect(screen.getByText(first.value).parent).not.toHaveStyle({ overflow: 'hidden' });
  expect(screen.getByRole('button', { name: t.seeOriginal })).toHaveStyle({ minHeight: 56, borderBottomWidth: 1 });
});

it('keeps the memoir outside a bordered card and preserves the visible accuracy warning', async () => {
  const props = bookProps(), t = realCopy.en;
  await render(<AutobiographyContent {...props} />);
  const prose = screen.getByText(props.draft!.content);
  expect(prose).toHaveProp('allowFontScaling', true);
  expect(prose).toHaveStyle({ fontSize: 22, lineHeight: 36 });
  expect(prose.parent).not.toHaveStyle({ borderWidth: 1 });
  expect(screen.getByText(t.reviewDraft)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t.historySection })).toHaveStyle({ minHeight: 56, borderBottomWidth: 1 });
  expect(screen.queryByText(t.modelReview)).toBeNull();
});


it.each(['en', 'sv'] as const)('offers unresolved memories before explicit story creation without silently changing eligibility in %s', async language => {
  const props = bookProps(language), copy = storyContentCopy[language], t = realCopy[language], generate = jest.fn();
  await render(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[first, reviewed]}
    generationControls={<LargeButton language={language} label={t.generate} onPress={generate} />} />);
  expect(screen.getByText(copy.pendingStory)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t.generate })).toBeEnabled();
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: copy.reviewFirst }));
  expect(props.onReviewMemories).toHaveBeenCalledTimes(1);
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: t.generate }));
  expect(generate).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('requires open questions to be resolved before generating, while keeping existing draft actions available in %s', async language => {
  const props = bookProps(language), copy = storyContentCopy[language], t = realCopy[language];
  const pending = realMemory({ clarification_question: 'Which date is right?', uncertain: true });
  const view = await render(<AutobiographyContent {...props} draft={null} drafts={[]} memories={[reviewed, pending]} />);
  expect(screen.getByText(copy.answerFirst)).toBeOnTheScreen();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: copy.reviewFirst }));
  expect(props.onReviewMemories).toHaveBeenCalledTimes(1);
  await view.rerender(<AutobiographyContent {...props} memories={[reviewed, pending]} />);
  expect(screen.getByRole('button', { name: t.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: t.export })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: t.createVersion }));
  expect(screen.getByText(copy.answerFirst)).toBeOnTheScreen();
  expect(screen.queryByText('Existing deliberate generation controls')).toBeNull();
  await view.rerender(<AutobiographyContent {...props} />);
  expect(screen.getByText('Existing deliberate generation controls')).toBeOnTheScreen();
});

it.each(['en', 'sv'] as const)('offers a visible draft and browser-appropriate PDF action in %s', async language => {
  jest.replaceProperty(Native.Platform, 'OS', 'web');
  const props = bookProps(language), copy = storyContentCopy[language], t = realCopy[language];
  await render(<AutobiographyContent {...props} />);
  expect(screen.getByRole('header', { name: copy.draftHeading })).toBeOnTheScreen();
  expect(screen.getByText(props.draft!.content)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t.export })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: copy.downloadPdf }));
  expect(props.onExport).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: copy.pdfDetails }));
  expect(screen.getByText(copy.browserPdf)).toBeOnTheScreen();
});
