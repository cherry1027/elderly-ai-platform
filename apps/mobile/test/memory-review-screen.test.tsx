import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, StyleSheet, Text, TextInput } from 'react-native';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import type { ConversationMessage } from '../src/api/conversation-messages';
import type { MemoryFact, MemoryClarification } from '../src/api/memory-review';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { MemoryReviewScreen, type MemoryReviewState } from '../src/memories/MemoryReviewScreen';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
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
function open(state: MemoryReviewState = initial, language: Language = 'en') {
  const actions = { onSave: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const view = render(<MemoryReviewScreen language={language} title="A fictional story" state={state} {...actions} />);
  return { ...view, ...actions };
}
function choose(label: 'confirm' | 'correct' | 'reject', language: Language = 'en') {
  fireEvent.press(screen.getByRole('radio', { name: memoryReviewCopy[language][label] }));
}
function save(language: Language = 'en') { fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy[language].save })); }

it.each(['en', 'sv'] as const)('shows one sourced suggestion without automatically saving in %s', language => {
  const actions = open(initial, language); const text = memoryReviewCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(`${text.memory} 1 ${text.of} 1`)).toBeOnTheScreen();
  expect(screen.getByText(text.simulated)).toBeOnTheScreen(); expect(screen.getByText(memory.evidence)).toBeOnTheScreen();
  expect(screen.getByText(`${text.status}: ${text.statuses.pending}`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  expect(actions.onSave).not.toHaveBeenCalled(); expect(actions.onRefresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(screen.queryByText(memory.id, { exact: false })).toBeNull(); expect(screen.queryByText(/version|expected_version/)).toBeNull();
});

it.each(['en', 'sv'] as const)('requires explicit confirmation and Save in %s', language => {
  const actions = open(initial, language); choose('confirm', language);
  expect(screen.getByRole('radio', { name: memoryReviewCopy[language].confirm }).props.accessibilityState).toMatchObject({ checked: true });
  expect(actions.onSave).not.toHaveBeenCalled(); save(language);
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed');
});

it('does not duplicate a Save while the controller is receiving the first deliberate action', () => {
  const actions = open(); choose('confirm'); save(); save();
  expect(actions.onSave).toHaveBeenCalledTimes(1);
});

it('preserves an existing correction when confirming without a change', () => {
  const corrected: MemoryFact = { ...memory, corrected_value: 'Stockholm', status: 'confirmed', version: 2 };
  const actions = open({ ...initial, memories: [corrected] });
  expect(screen.getByText('Stockholm')).toBeOnTheScreen(); expect(screen.getByText('Malmö')).toBeOnTheScreen();
  choose('confirm'); save(); expect(actions.onSave).toHaveBeenCalledWith(corrected, 'confirmed');
  expect(screen.getByText(`${memoryReviewCopy.en.originalYear}: 1974`)).toBeOnTheScreen();
});

it('does not send an unchanged correction field as a new correction', () => {
  const corrected: MemoryFact = { ...memory, corrected_value: 'Stockholm', status: 'confirmed', version: 2 };
  const actions = open({ ...initial, memories: [corrected] }); choose('correct'); save();
  expect(actions.onSave).toHaveBeenCalledWith(corrected, 'confirmed');
});

it.each(['en', 'sv'] as const)('normalizes a deliberate correction while retaining original source and year in %s', language => {
  const actions = open(initial, language); const text = memoryReviewCopy[language]; choose('correct', language);
  fireEvent.changeText(screen.getByLabelText(text.correctionLabel), ' \u0085 1975 \u0085 '); save(language);
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed', '1975');
  expect(screen.getByText(`${text.originalYear}: 1974`)).toBeOnTheScreen();
  expect(screen.getByText(memory.evidence)).toBeOnTheScreen();
  expect(screen.queryByText(text.saved)).toBeNull();
});

it('never submits a correction with rejection, even after a correction was typed', () => {
  const actions = open(); choose('correct'); fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  choose('reject'); expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull(); save();
  expect(actions.onSave).toHaveBeenCalledWith(memory, 'rejected');
});

it.each(['', ' ', '\u0085', '\u2003\u3000', '\u200b\u2060', '\u0000', '\ud800', 'x'.repeat(1001)])('rejects blank or invalid correction %p without a save', draft => {
  const actions = open(); choose('correct'); fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), draft); save();
  expect(screen.getByRole('alert')).toHaveTextContent(memoryReviewCopy.en.correctionError);
  expect(screen.getByLabelText(memoryReviewCopy.en.correctionLabel).props.accessibilityHint).toContain(memoryReviewCopy.en.correctionError);
  expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('keeps the correction when keyboard Done is pressed in %s', language => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  try {
    const actions = open(initial, language); const text = memoryReviewCopy[language]; choose('correct', language);
    const field = screen.getByLabelText(text.correctionLabel); fireEvent.changeText(field, 'Ett påhittat minne');
    fireEvent(field, 'submitEditing'); expect(dismiss).toHaveBeenCalled();
    expect(screen.getByLabelText(text.correctionLabel).props.value).toBe('Ett påhittat minne');
    expect(actions.onSave).not.toHaveBeenCalled(); save(language);
    expect(actions.onSave).toHaveBeenCalledWith(memory, 'confirmed', 'Ett påhittat minne');
  } finally { dismiss.mockRestore(); }
});

it('clears the unsaved draft when correction is cancelled without sending anything', () => {
  const actions = open(); choose('correct'); fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.cancelCorrection }));
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  choose('correct'); expect(screen.getByLabelText(memoryReviewCopy.en.correctionLabel).props.value).toBe(memory.value);
  expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('supports read-only full-source disclosure without exposing it by default in %s', language => {
  const actions = open(initial, language); const text = memoryReviewCopy[language];
  expect(screen.queryByText(source.text)).toBeNull();
  const show = screen.getByRole('button', { name: text.showSource }); expect(show.props.accessibilityState).toMatchObject({ expanded: false });
  fireEvent.press(show); expect(screen.getByText(source.text)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.hideSource }).props.accessibilityState).toMatchObject({ expanded: true });
  fireEvent.press(screen.getByRole('button', { name: text.hideSource })); expect(screen.queryByText(source.text)).toBeNull();
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('does not label an unmarked but matched original as a fictional simulation', () => {
  open({ ...initial, sources: [{ ...source, text: 'I moved to Malmö in 1974. I worked as a teacher.' }] });
  expect(screen.getByText(memoryReviewCopy.en.unclassified)).toBeOnTheScreen(); expect(screen.queryByText(memoryReviewCopy.en.simulated)).toBeNull();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeEnabled();
});

it.each(['missing', 'foreign-session', 'assistant', 'unmatched-evidence', 'unmatched-value'] as const)('blocks Save when source is %s', kind => {
  const changed = kind === 'foreign-session' ? { ...source, session_id: 'another-session' }
    : kind === 'assistant' ? { ...source, role: 'assistant' as const }
      : { ...source, text: kind === 'unmatched-evidence' ? 'Malmö but no supporting quote.' : 'No original value here.' };
  const actions = open({ ...initial, sources: kind === 'missing' ? [] : [changed] });
  expect(screen.getByText(memoryReviewCopy.en.sourceMissing)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeDisabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  expect(screen.queryByRole('button', { name: memoryReviewCopy.en.showSource })).toBeNull(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('shows at most three current-memory questions and a truthful total, with no automatic resolution', () => {
  const questions: MemoryClarification[] = Array.from({ length: 5 }, (_, index) => ({
    id: `question-${index}`, fact_id: memory.id, session_id: source.session_id, conflicts_with_fact_id: second.id,
    question: `Fictional clarification ${index + 1}?`, status: 'open', resolution: null, created_at: source.created_at, resolved_at: null,
  }));
  const actions = open({ ...initial, clarifications: [...questions, { ...questions[0], id: 'other-question', fact_id: second.id, question: 'Question for another memory?' }] });
  expect(screen.getByText(questions[0].question)).toBeOnTheScreen(); expect(screen.getByText(questions[2].question)).toBeOnTheScreen();
  expect(screen.queryByText(questions[3].question)).toBeNull(); expect(screen.queryByText('Question for another memory?')).toBeNull();
  expect(screen.getByText(`${memoryReviewCopy.en.questionsCount}: 3 ${memoryReviewCopy.en.of} 5`)).toBeOnTheScreen();
  expect(screen.getByText(memoryReviewCopy.en.questionHelp)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('moves one memory at a time and discards unsaved local drafts without changing records', () => {
  const actions = open({ ...initial, memories: [memory, second] }); const text = memoryReviewCopy.en;
  expect(screen.getByRole('button', { name: text.previous })).toBeDisabled(); expect(screen.queryByText('teacher')).toBeNull();
  choose('correct'); fireEvent.changeText(screen.getByLabelText(text.correctionLabel), 'unsaved correction');
  fireEvent.press(screen.getByRole('button', { name: text.next })); expect(screen.getByText(`${text.memory} 2 ${text.of} 2`)).toBeOnTheScreen();
  expect(screen.queryByLabelText(text.correctionLabel)).toBeNull(); expect(screen.getByRole('button', { name: text.next })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.save })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: text.previous })); choose('correct');
  expect(screen.getByLabelText(text.correctionLabel).props.value).toBe(memory.value); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['loading', 'saving', 'error', 'conflict', 'uncertain'] as const)('prevents new saves in %s state', phase => {
  const actions = open({ ...initial, phase }); const text = memoryReviewCopy.en;
  if (phase === 'loading') { expect(screen.getByText(text.loading)).toBeOnTheScreen(); expect(screen.queryByRole('radio')).toBeNull(); }
  else {
    expect(screen.getByRole('radio', { name: text.confirm })).toBeDisabled();
    expect(screen.getByRole('button', { name: phase === 'saving' ? text.saving : text.save })).toBeDisabled();
  }
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires complete review data before enabling a choice', () => {
  open({ ...initial, complete: false }); expect(screen.getByText(memoryReviewCopy.en.incomplete)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: memoryReviewCopy.en.confirm })).toBeDisabled();
});

it.each(Object.keys(memoryReviewCopy.en.errors) as StoryProjectsErrorKind[])('shows only a translated safe %s error', error => {
  open({ ...initial, phase: 'error', error }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(memoryReviewCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|file:\/\//)).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides supplied stale private content after %s failure', error => {
  open({ ...initial, phase: 'error', error });
  expect(screen.queryByText('A fictional story')).toBeNull(); expect(screen.queryByText(memory.evidence)).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
});

it('shows success only when the controller reports a saved review', () => {
  const actions = open(); expect(screen.queryByText(memoryReviewCopy.en.saved)).toBeNull();
  actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={{ ...initial, notice: 'saved' }} {...actions} />);
  expect(screen.getByText(memoryReviewCopy.en.saved)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires a fresh explicit choice after a new version is loaded', () => {
  const actions = open(); choose('correct'); fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), '1975');
  actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={{ ...initial, notice: 'conflict',
    memories: [{ ...memory, version: 2 }] }} {...actions} />);
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
  expect(screen.getByText(memoryReviewCopy.en.conflict)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('announces correction errors without including draft contents', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    open(); choose('correct'); fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), 'x'.repeat(1001)); save();
    expect(announce).toHaveBeenCalledWith(memoryReviewCopy.en.correctionError);
    expect(announce.mock.calls.flat().join(' ')).not.toContain('x'.repeat(1001));
  } finally { announce.mockRestore(); }
});

it.each(['en', 'sv'] as const)('provides working refresh, Back and Sign Out without implicit saves in %s', language => {
  const actions = open(initial, language); const text = memoryReviewCopy[language];
  for (const [label, callback] of [[text.refresh, actions.onRefresh], [text.back, actions.onBack], [text.signOut, actions.onSignOut]] as const) {
    fireEvent.press(screen.getByRole('button', { name: label })); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('offers an honest empty state without fabricated suggestions', () => {
  const actions = open({ ...initial, memories: [], sources: [], clarifications: [] });
  expect(screen.getByText(memoryReviewCopy.en.empty)).toBeOnTheScreen(); expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByText(memory.evidence)).toBeNull(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('uses large controls, scalable unclipped text and an accessible correction input', () => {
  open(); choose('correct');
  for (const role of ['button', 'radio'] as const) for (const control of screen.getAllByRole(role)) expect(control).toHaveStyle({ minHeight: 56 });
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  const input = screen.UNSAFE_getByType(TextInput); expect(input.props.allowFontScaling).toBe(true);
  expect(input.props.accessibilityLabel).toBe(memoryReviewCopy.en.correctionLabel);
  expect(input.props.maxLength).toBeUndefined(); expect(input.props.onSubmitEditing).toEqual(expect.any(Function));
});

it('disables Refresh after an access failure while leaving Back and Sign Out available', () => {
  open({ ...initial, phase: 'error', memories: [], sources: [], error: 'authentication' });
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.refresh })).toBeDisabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.back })).toBeEnabled();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.signOut })).toBeEnabled();
});
it('uses the saved source language for facts and questions when interface language differs', () => {
  const question: MemoryClarification = { id: 'question', fact_id: memory.id, session_id: source.session_id,
    conflicts_with_fact_id: null, question: 'A fictional question?', status: 'open', resolution: null,
    created_at: source.created_at, resolved_at: null };
  open({ ...initial, memories: [{ ...memory, corrected_value: 'Fictional correction', status: 'confirmed' }],
    clarifications: [question] }, 'sv');
  expect(screen.getByText('Fictional correction').props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(question.question).props.accessibilityLanguage).toBe('en-GB');
});

it('retains the selected memory after authoritative reload while clearing only its unsaved form', () => {
  const state = { ...initial, memories: [memory, second] };
  const actions = open(state);
  fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.next }));
  choose('correct');
  fireEvent.changeText(screen.getByLabelText(memoryReviewCopy.en.correctionLabel), 'Fictional unsaved correction');
  actions.rerender(<MemoryReviewScreen language="en" title="A fictional story" state={state} resetRevision={1} {...actions} />);
  expect(screen.getByText('Memory 2 of 2')).toBeOnTheScreen();
  expect(screen.queryByLabelText(memoryReviewCopy.en.correctionLabel)).toBeNull();
  expect(screen.getByRole('button', { name: memoryReviewCopy.en.save })).toBeDisabled();
});
it('announces count-only paging without reading original source aloud automatically', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    open({ ...initial, memories: [memory, second] }); announce.mockClear();
    fireEvent.press(screen.getByRole('button', { name: memoryReviewCopy.en.next }));
    expect(announce).toHaveBeenCalledWith('Memory 2 of 2');
    expect(announce).not.toHaveBeenCalledWith(source.text);
    expect(screen.getByText('Memory 2 of 2').props.accessibilityLiveRegion).toBe('polite');
  } finally { announce.mockRestore(); }
});
