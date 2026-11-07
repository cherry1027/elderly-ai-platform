import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import { LargeButton } from '../src/components/LargeButton';
import { AutobiographyContent, MemoriesContent, type AutobiographyContentProps, type MemoriesContentProps, storyContentCopy } from '../src/real-ai/StoryContent';
import { realCopy } from '../src/real-ai/copy';
import { realDate, realDraft, realMemory } from './real-ai-fixtures';
import type { StoryEdit } from '../src/api/story-drafts';

jest.mock('../src/components/LargeButton', () => {
  const actual = jest.requireActual<typeof import('../src/components/LargeButton')>('../src/components/LargeButton');
  return { ...actual, LargeButton: jest.fn(actual.LargeButton) };
});
const noop = () => {};
const saved = Array.from({ length: 40 }, (_, index) => realMemory({
  id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  value: `Synthetic memory ${index}`, evidence: `Exact original ${index}`, clarification_question: null,
}));
const memoryProps = (): MemoriesContentProps => ({ language: 'en', storyLanguage: 'en', memories: saved,
  corrections: {}, blocked: false, busy: false, onReview: jest.fn(), onCorrection: jest.fn(), onShareMemory: noop });
const card = (value: string) => within(screen.getByText(value).parent!);

afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); });

it('typing one correction rebuilds only its changed card, rather than all 40 saved memory cards', async () => {
  function Harness() {
    const [corrections, setCorrections] = useState<Record<string, string>>({});
    return <MemoriesContent {...memoryProps()} corrections={corrections}
      onCorrection={(id, value) => setCorrections(before => ({ ...before, [id]: value }))} />;
  }
  await render(<Harness />);
  const initialControls = jest.mocked(LargeButton).mock.calls.length;
  expect(initialControls).toBeGreaterThanOrEqual(saved.length * 2);
  await fireEvent.press(card(saved[0].value).getByRole('button', { name: realCopy.en.correctAction }));
  const input = card(saved[0].value).getByLabelText(realCopy.en.correct);
  const beforeTyping = jest.mocked(LargeButton).mock.calls.length;
  for (const text of ['Exact', 'Exact corrected', 'Exact corrected wording']) await fireEvent.changeText(input, text);
  const changedControls = jest.mocked(LargeButton).mock.calls.length - beforeTyping;
  expect(changedControls).toBeLessThan(10);
  expect(card(saved[0].value).getByLabelText(realCopy.en.correct).props.value).toBe('Exact corrected wording');
  expect(screen.getByText(saved[39].value)).toBeOnTheScreen();
});

it('memoized controls use the current handler and current blocked state, and retire captured callbacks on unmount', async () => {
  const before = memoryProps(), after = { ...before, onReview: jest.fn() };
  const view = await render(<MemoriesContent {...before} />);
  const captured = jest.mocked(LargeButton).mock.calls.find(([props]) => props.label === realCopy.en.confirm)![0].onPress;
  const count = jest.mocked(LargeButton).mock.calls.length;
  await view.rerender(<MemoriesContent {...after} />);
  expect(jest.mocked(LargeButton).mock.calls.length).toBe(count);
  await act(() => captured());
  expect(before.onReview).not.toHaveBeenCalled(); expect(after.onReview).toHaveBeenCalledWith(saved[0], 'confirmed');
  await view.rerender(<MemoriesContent {...after} blocked busy />);
  await act(() => captured()); expect(after.onReview).toHaveBeenCalledTimes(1);
  await view.unmount(); await act(() => captured()); expect(after.onReview).toHaveBeenCalledTimes(1);
});

it('a captured older-row action cannot review a replaced or removed saved version', async () => {
  const props = memoryProps(), old = saved[0], next = { ...old, version: old.version + 1, corrected_value: 'Verified replacement' };
  const view = await render(<MemoriesContent {...props} memories={[old]} />);
  const stale = jest.mocked(LargeButton).mock.calls.find(([props]) => props.label === realCopy.en.confirm)![0].onPress;
  await view.rerender(<MemoriesContent {...props} memories={[next]} />);
  await act(() => stale()); expect(props.onReview).not.toHaveBeenCalled();
  await fireEvent.press(card(next.corrected_value!).getByRole('button', { name: realCopy.en.confirm }));
  expect(props.onReview).toHaveBeenCalledWith(next, 'confirmed');
  await view.rerender(<MemoriesContent {...props} memories={[]} />);
  await act(() => stale()); expect(props.onReview).toHaveBeenCalledTimes(1);
});

it('memoized memory rows still update language, disabled actions and immutable original evidence', async () => {
  const props = memoryProps(), memory = saved[0];
  const view = await render(<MemoriesContent {...props} memories={[memory]} />);
  await fireEvent.press(screen.getByRole('button', { name: realCopy.en.seeOriginal }));
  expect(screen.getByText(memory.evidence)).toHaveProp('selectable', true);
  await view.rerender(<MemoriesContent {...props} memories={[memory]} language="sv" storyLanguage="sv" blocked busy />);
  expect(screen.getByRole('button', { name: realCopy.sv.confirm })).toBeDisabled();
  expect(screen.getByText(memory.evidence)).toBeOnTheScreen();
  expect(screen.getByText(memory.evidence)).toHaveProp('accessibilityLanguage', 'sv-SE');
});

it('editing story wording does not rebuild hidden saved source or revision prose, while new evidence updates correctly', async () => {
  let sourceMaps = 0, historyMaps = 0;
  const originalDraft = realDraft(), sources = new Proxy(originalDraft.source_memories, {
    get(target, key, receiver) { if (key === 'map') sourceMaps++; return Reflect.get(target, key, receiver); },
  });
  const savedHistory: StoryEdit[] = [{ id: '70000000-0000-4000-8000-000000000002', draft_id: originalDraft.draft_id,
    revision: 1, previous_content: 'Earlier revision.', content: 'Saved original revision.', created_at: realDate }];
  const history = new Proxy(savedHistory, {
    get(target, key, receiver) { if (key === 'map') historyMaps++; return Reflect.get(target, key, receiver); },
  });
  const props: AutobiographyContentProps = {
    language: 'en', storyLanguage: 'en', draft: { ...originalDraft, source_memories: sources }, drafts: [originalDraft], memories: [],
    editor: null, history, exports: [], blocked: false, busy: false, ambiguousEdit: false, usageBlocked: false,
    writingAvailable: true, privacyReady: true, privacyFailed: false, generationControls: <Text>Explicit generation</Text>,
    onEdit: noop, onChangeEditor: noop, onSave: noop, onCancel: noop, onSelectDraft: noop, onLoadHistory: noop,
    onLoadExports: noop, onExport: noop, onDownloadExport: noop, onReviewMemories: noop, onShareMemory: noop,
  };
  const view = await render(<AutobiographyContent {...props} />);
  expect(sourceMaps).toBe(1); expect(historyMaps).toBe(1);
  for (const editor of ['My story', 'My story begins', 'My story begins here.']) await view.rerender(<AutobiographyContent {...props} editor={editor} />);
  expect(sourceMaps).toBe(1); expect(historyMaps).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: storyContentCopy.en.aboutVersion }));
  expect(screen.getByText(sources[0].evidence)).toHaveProp('selectable', true);
  const updated = { ...originalDraft, source_memories: [{ ...sources[0], corrected_value: 'Verified newer memory' }] };
  await view.rerender(<AutobiographyContent {...props} draft={updated} editor="My story begins here." />);
  expect(screen.getByText('Verified newer memory')).toBeOnTheScreen();
  expect(screen.getByText(sources[0].evidence)).toBeOnTheScreen();
});
