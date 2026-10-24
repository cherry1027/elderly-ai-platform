import { nativeNodes, nativeNode } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, StyleSheet } from 'react-native';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import type { ConversationMessage } from '../src/api/conversation-messages';
import type { MemoryFact, MemoryClarification } from '../src/api/memory-review';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { MemoryReviewScreen, type MemoryReviewState } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import type { Language } from '../src/i18n';

const source: ConversationMessage = { id: '20000000-0000-4000-8000-000000000001',
  session_id: '10000000-0000-4000-8000-000000000001', sequence: 1, role: 'user', language: 'en',
  text: SIMULATED_TRANSCRIPT_NOTICE + 'I moved to Malmö in 1974. I worked as a teacher.', created_at: '2026-10-21T10:00:00Z' };
const memory: MemoryFact = { id: '30000000-0000-4000-8000-000000000001',
  project_id: '40000000-0000-4000-8000-000000000001', session_id: source.session_id, source_message_id: source.id,
  fact_type: 'event', value: 'Malmö', evidence: 'I moved to Malmö in 1974.', year: 1974, slot: 'move', uncertain: false,
  status: 'pending', corrected_value: null, version: 1, created_at: source.created_at, updated_at: source.created_at };
const second: MemoryFact = { ...memory, id: '30000000-0000-4000-8000-000000000002',
  value: 'teacher', evidence: 'I worked as a teacher.', slot: 'occupation', year: null };
const initial: MemoryReviewState = { phase: 'ready', memories: [memory], clarifications: [], sources: [source], complete: true };
async function open(state: MemoryReviewState = initial, language: Language = 'en') {
  const actions = { onSave: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const view = await render(<MemoryReviewScreen language={language} title="A fictional story" state={state} {...actions} />);
  return { ...view, ...actions };
}
async function choose(label: 'confirm' | 'correct' | 'reject', language: Language = 'en') {
  await fireEvent.press(screen.getByRole('radio', { name: memoryReviewCopy[language][label] }));
}
async function save(language: Language = 'en') { await fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy[language].save })); }

it.each(['en', 'sv'] as const)('shows one sourced suggestion without automatically saving in %s', async language => {
  const actions = await open(initial, language); const text = memoryReviewCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(`${text.memory} 1 ${text.of} 1`)).toBeOnTheScreen();
  expect(screen.getByText(text.simulated)).toBeOnTheScreen(); expect(screen.getByText(memory.evidence)).toBeOnTheScreen();
  expect(screen.getByText(`${text.status}: ${text.statuses.pending}`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  expect(actions.onSave).not.toHaveBeenCalled(); expect(actions.onRefresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(memory.id, { exact: false })).toBeNull(); expect(screen.queryByText(/version|expected_version/)).toBeNull();
});

it.each(['en', 'sv'] as const)('requires explicit confirmation and Save in %s', async language => {
  const actions = await open(initial, language); await choose('confirm', language);
  expect(screen.getByRole('radio', { name: memoryReviewCopy[language].confirm }).props.accessibilityState).toMatchObject({ checked: true });
  expect(actions.onSave).not.toHaveBeenCalled(); await save(language);
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed');
});

it('does not duplicate a Save while the controller is receiving the first deliberate action', async () => {
  const actions = await open(); await choose('confirm'); await save(); await save();
  expect(actions.onSave).toHaveBeenCalledTimes(1);
});

it('preserves an existing correction when confirming without a change', async () => {
  const corrected: MemoryFact = { ...memory, corrected_value: 'Stockholm', status: 'confirmed', version: 2 };
  const actions = await open({ ...initial, memories: [corrected] });
  expect(screen.getByText('Stockholm')).toBeOnTheScreen(); expect(screen.getByText('Malmö')).toBeOnTheScreen();
  await choose('confirm'); await save(); expect(actions.onSave).toHaveBeenCalledWith(corrected, 'confirmed');
  expect(screen.getByText(`${memoryReviewCopy.en.originalYear}: 1974`)).toBeOnTheScreen();
});

it('does not send an unchanged correction field as a new correction', async () => {
  const corrected: MemoryFact = { ...memory, corrected_value: 'Stockholm', status: 'confirmed', version: 2 };
  const actions = await open({ ...initial, memories: [corrected] }); await choose('correct'); await save();
  expect(actions.onSave).toHaveBeenCalledWith(corrected, 'confirmed');
});

it.each(['en', 'sv'] as const)('normalizes a deliberate correction while retaining original source and year in %s', async language => {
  const actions = await open(initial, language); const text = memoryReviewCopy[language]; await choose('correct', language);
  await fireEvent.changeText(screen.getByLabelText(text.correctionLabel), ' \u0085 1975 \u0085 '); await save(language);
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed', '1975');
  expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen();
  expect(screen.getByText(memory.evidence)).toBeOnTheScreen();
  expect(screen.queryByText(text.saved)).toBeNull();
});

it('never submits a correction with rejection, even after a correction was typed', async () => {
  const actions = await open(); await choose('correct'); await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  await choose('reject'); expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull(); await save();
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'rejected');
});

it.each(['', ' ', '\u0085', '\u2003\u3000', '\u200b\u2060', '\u0000', '\ud800', 'x'.repeat(1001)])('rejects blank or invalid correction %p without a save', async draft => {
  const actions = await open(); await choose('correct'); await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), draft); await save();
  expect(screen.getByRole('alert')).toHaveTextContent(memoryReviewCopy.en.correctionError);
  expect(screen.getByLabelText(memoryReviewCopy.en.correctionLabel).props.accessibilityHint).toContain(memoryReviewCopy.en.correctionError);
  expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('keeps the correction when keyboard Done is pressed in %s', async language => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  try {
    const actions = await open(initial, language); const text = memoryReviewCopy[language]; await choose('correct', language);
    const field = screen.getByLabelText(text.correctionLabel); await fireEvent.changeText(field, 'Ett påhittat minne');
    await fireEvent(field, 'submitEditing'); expect(dismiss).toHaveBeenCalled();
    expect(screen.getByLabelText(text.correctionLabel).props.value).toBe('Ett påhittat minne');
    expect(actions.onSave).not.toHaveBeenCalled(); await save(language);
    expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed', 'Ett påhittat minne');
  } finally { dismiss.mockRestore(); }
});

it('clears the unsaved draft when correction is cancelled without sending anything', async () => {
  const actions = await open(); await choose('correct'); await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  await fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.cancelCorrection }));
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  await choose('correct'); expect(screen.getByLabelText(memoryReviewCopy.en.correctionLabel).props.value).toBe(memory.value);
  expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('supports read-only full-source disclosure without exposing it by default in %s', async language => {
  const actions = await open(initial, language); const text = memoryReviewCopy[language];
  expect(screen.queryByText(source.text)).toBeNull();
  const show = screen.getByRole('button', { name: text.showSource }); expect(show.props.accessibilityState).toMatchObject({ expanded: false });
  await fireEvent.press(show); expect(screen.getByText(source.text)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.hideSource }).props.accessibilityState).toMatchObject({ expanded: true });
  await fireEvent.press(screen.getByRole('button', { name: text.hideSource })); expect(screen.queryByText(source.text)).toBeNull();
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('does not label an unmarked but matched original as a fictional simulation', async () => {
  await open({ ...initial, sources: [{ ...source, text: 'I moved to Malmö in 1974. I worked as a teacher.' }] });
  expect(screen.getByText(memoryReviewCopy.en.unclassified)).toBeOnTheScreen(); expect(screen.queryByText(memoryReviewCopy.en.simulated)).toBeNull();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeEnabled();
});

it.each(['missing', 'foreign-session', 'assistant', 'unmatched-evidence', 'unmatched-value'] as const)('blocks Save when source is %s', async kind => {
  const changed = kind === 'foreign-session' ? { ...source, session_id: 'another-session' }
    : kind === 'assistant' ? { ...source, role: 'assistant' as const }
      : { ...source, text: kind === 'unmatched-evidence' ? 'Malmö but no supporting quote.' : 'No original value here.' };
  const actions = await open({ ...initial, sources: kind === 'missing' ? [] : [changed] });
  expect(screen.getByText(memoryReviewCopy.en.sourceMissing)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeDisabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  expect(screen.queryByRole('button', { name: memoryReviewCopy.en.showSource })).toBeNull(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('shows at most three current-memory questions and a truthful total, with no automatic resolution', async () => {
  const questions: MemoryClarification[] = Array.from({ length: 5 }, (_, index) => ({
    id: `question-${index}`, fact_id: memory.id, session_id: source.session_id, conflicts_with_fact_id: second.id,
    question: `Fictional clarification ${index + 1}?`, status: 'open', resolution: null, created_at: source.created_at, resolved_at: null,
  }));
  const actions = await open({ ...initial, clarifications: [...questions, { ...questions[0], id: 'other-question', fact_id: second.id, question: 'Question for another memory?' }] });
  expect(screen.getByText(questions[0].question)).toBeOnTheScreen(); expect(screen.getByText(questions[2].question)).toBeOnTheScreen();
  expect(screen.queryByText(questions[3].question)).toBeNull(); expect(screen.queryByText('Question for another memory?')).toBeNull();
  expect(screen.getByText(`${memoryReviewCopy.en.questionsCount}: 3 ${memoryReviewCopy.en.of} 5`)).toBeOnTheScreen();
  expect(screen.getByText(memoryReviewCopy.en.questionHelp)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('moves one memory at a time only after explicitly discarding an unsaved review, without changing records', async () => {
  const actions = await open({ ...initial, memories: [memory, second] }); const text = memoryReviewCopy.en;
  expect(screen.getByRole('button', { name: text.previous })).toBeDisabled(); expect(screen.queryByText('teacher')).toBeNull();
  await choose('correct'); await fireEvent.changeText(screen.getByLabelText(text.correctionLabel), 'unsaved correction');
  await fireEvent.press(screen.getByRole('button', { name: text.next }));
  expect(actions.onSave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.keep }));
  expect(screen.getByLabelText(text.correctionLabel)).toHaveProp('value', 'unsaved correction');
  await fireEvent.press(screen.getByRole('button', { name: text.next }));
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy.en.discard }));
  expect(screen.getByText(`${text.memory} 2 ${text.of} 2`)).toBeOnTheScreen();
  expect(screen.queryByLabelText(text.correctionLabel)).toBeNull(); expect(screen.getByRole('button', { name: text.next })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: text.previous })); await choose('correct');
  expect(screen.getByLabelText(text.correctionLabel).props.value).toBe(memory.value); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['loading', 'saving', 'error', 'conflict', 'uncertain'] as const)('prevents new saves in %s state', async phase => {
  const actions = await open({ ...initial, phase }); const text = memoryReviewCopy.en;
  if (phase === 'loading') { expect(screen.getByText(text.loading)).toBeOnTheScreen(); expect(screen.queryByRole('radio')).toBeNull(); }
  else {
    expect(screen.getByRole('radio', { name: text.confirm })).toBeDisabled();
    expect(screen.getByRole('button', { name: phase === 'saving' ? text.saving : text.save })).toBeDisabled();
  }
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires complete review data before enabling a choice', async () => {
  await open({ ...initial, complete: false }); expect(screen.getByText(memoryReviewCopy.en.incomplete)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeDisabled();
});

it.each(Object.keys(memoryReviewCopy.en.errors) as StoryProjectsErrorKind[])('shows only a translated safe %s error', async error => {
  await open({ ...initial, phase: 'error', error }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(memoryReviewCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|file:\/\//)).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides supplied stale private content after %s failure', async error => {
  await open({ ...initial, phase: 'error', error });
  expect(screen.queryByText('A fictional story')).toBeNull(); expect(screen.queryByText(memory.evidence)).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
});

it('shows success only when the controller reports a saved review', async () => {
  const actions = await open(); expect(screen.queryByText(memoryReviewCopy.en.saved)).toBeNull();
  await actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={{ ...initial, notice: 'saved' }} {...actions} />);
  expect(screen.getByText(memoryReviewCopy.en.saved)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires a fresh explicit choice after a new version is loaded', async () => {
  const actions = await open(); await choose('correct'); await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  await actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={{ ...initial, notice: 'conflict',
    memories: [{ ...memory, version: 2 }] }} {...actions} />);
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  expect(screen.getByText(memoryReviewCopy.en.conflict)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('announces correction errors without including draft contents', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    await open(); await choose('correct'); await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), 'x'.repeat(1001)); await save();
    expect(announce).toHaveBeenCalledWith(memoryReviewCopy.en.correctionError);
    expect(announce.mock.calls.flat().join(' ')).not.toContain('x'.repeat(1001));
  } finally { announce.mockRestore(); }
});

it.each(['en', 'sv'] as const)('provides working refresh, Back and Sign Out without implicit saves in %s', async language => {
  const actions = await open(initial, language); const text = memoryReviewCopy[language];
  for (const [label, callback] of [[text.refresh, actions.onRefresh], [text.back, actions.onBack], [text.signOut, actions.onSignOut]] as const) {
    await fireEvent.press(screen.getByRole('button', { name: label })); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('offers an honest empty state without fabricated suggestions', async () => {
  const actions = await open({ ...initial, memories: [], sources: [], clarifications: [] });
  expect(screen.getByText(memoryReviewCopy.en.empty)).toBeOnTheScreen(); expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByText(memory.evidence)).toBeNull(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('uses large controls, scalable unclipped text and an accessible correction input', async () => {
  await open(); await choose('correct');
  for (const role of ['button', 'radio'] as const) for (const control of screen.getAllByRole(role)) expect(control).toHaveStyle({ minHeight: 56 });
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  const input = nativeNode('input'); expect(input.props.allowFontScaling).toBe(true);
  expect(input.props.accessibilityLabel).toBe(memoryReviewCopy.en.correctionLabel);
  expect(input.props.maxLength).toBeUndefined(); expect(input.props.onSubmitEditing).toEqual(expect.any(Function));
});

it('disables Refresh after an access failure while leaving Back and Sign Out available', async () => {
  await open({ ...initial, phase: 'error', memories: [], sources: [], error: 'authentication' });
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.refresh })).toBeDisabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.back })).toBeEnabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.signOut })).toBeEnabled();
});
it('uses the saved source language for facts and questions when interface language differs', async () => {
  const question: MemoryClarification = { id: 'question', fact_id: memory.id, session_id: source.session_id,
    conflicts_with_fact_id: null, question: 'A fictional question?', status: 'open', resolution: null,
    created_at: source.created_at, resolved_at: null };
  await open({ ...initial, memories: [{ ...memory, corrected_value: 'Fictional correction', status: 'confirmed' }],
    clarifications: [question] }, 'sv');
  expect(screen.getByText('Fictional correction').props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(question.question).props.accessibilityLanguage).toBe('en-GB');
});

it('retains the selected memory after authoritative reload while clearing only its unsaved form', async () => {
  const state = { ...initial, memories: [memory, second] };
  const actions = await open(state);
  await fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.next }));
  await choose('correct');
  await fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), 'Fictional unsaved correction');
  await actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={state} resetRevision={1} {...actions} />);
  expect(screen.getByText('Memory 2 of 2')).toBeOnTheScreen();
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
});
it('announces count-only paging without reading original source aloud automatically', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    await open({ ...initial, memories: [memory, second] }); announce.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.next }));
    expect(announce).toHaveBeenCalledWith('Memory 2 of 2');
    expect(announce).not.toHaveBeenCalledWith(source.text);
    expect(screen.getByText('Memory 2 of 2').props.accessibilityLiveRegion).toBe('polite');
  } finally { announce.mockRestore(); }
});
