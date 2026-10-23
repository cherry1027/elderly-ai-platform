import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, StyleSheet, Text, TextInput } from 'react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import { Screen } from '../src/components/Screen';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { DraftEditorScreen, type DraftEditingState } from '../src/generation/DraftEditorScreen';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import type { Language } from '../src/i18n';

const draft: StoryDraft = { draft_id: '95000000-0000-4000-8000-000000000001', project_id: '95200000-0000-4000-8000-000000000001',
  status: 'ready_for_review', language: 'en', style: 'warm', version: 1, revision: 1, content: 'I grew up in Malmö.',
  original_content: 'I grew up in Malmö.', mode: 'mock', source_memories: [],
  verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
    checked_at: '2026-10-23T10:00:00Z', sources_current: true, reason: null },
  created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' };
const initial: DraftEditingState = { phase: 'editing', draft, text: draft.content, canRetry: false, dirty: true };
function open(state: DraftEditingState = initial, language: Language = 'en', storyLanguage: Language = 'en') {
  const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
    onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const view = render(<DraftEditorScreen language={language} storyLanguage={storyLanguage} title="Fictional story"
    state={state} {...actions} />);
  return { ...view, ...actions };
}
function tap(label: string) { fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('shows native controlled wording without a write in %s', language => {
  const actions = open(initial, language); const text = draftEditingCopy[language];
  expect(screen.getByRole('header', { name: text.editorTitle })).toBeOnTheScreen();
  expect(screen.getByLabelText(text.field).props.value).toBe(draft.content);
  expect(screen.getByText(text.simulation)).toBeOnTheScreen(); expect(screen.getByText(text.preservation)).toBeOnTheScreen();
  expect(screen.getByText(text.privacy)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('retains controlled paragraphs when keyboard Done, blur and Done typing occur', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  try {
    const value = 'Jag växte upp i Malmö.\n\nDet här är min egen formulering.';
    const actions = open({ ...initial, text: value }); const input = screen.getByLabelText(draftEditingCopy.en.field);
    fireEvent(input, 'submitEditing', { nativeEvent: { text: value } }); fireEvent(input, 'blur');
    tap(draftEditingCopy.en.done);
    expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(value); expect(dismiss).toHaveBeenCalled();
    expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
    expect(input.props.submitBehavior).toBe('newline'); expect(input.props.multiline).toBe(true);
  } finally { dismiss.mockRestore(); }
});

it('passes a changed paragraph to the controller without trimming or silently saving', () => {
  const actions = open(); const value = '  My wording.\n\n  Another paragraph.  ';
  fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), value);
  expect(actions.onChangeText).toHaveBeenCalledWith(value); expect(actions.onSave).not.toHaveBeenCalled();
});

it('saves only after explicit action and blocks a repeated tap before controller state changes', () => {
  const actions = open(); tap(draftEditingCopy.en.save); tap(draftEditingCopy.en.save);
  expect(actions.onSave).toHaveBeenCalledTimes(1); expect(actions.onCheck).not.toHaveBeenCalled();
});

it('does not invite an unnecessary save when no wording changed', () => {
  const actions = open({ ...initial, dirty: false });
  expect(screen.getByRole('button', { name: draftEditingCopy.en.save })).toBeDisabled();
  expect(screen.getByText(draftEditingCopy.en.unchanged)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['required', 'too-long', 'invalid'] as const)('shows visible, accessible %s validation in both field hint and notice', validation => {
  const actions = open({ ...initial, validation }, 'sv'); const text = draftEditingCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.validation[validation]);
  expect(screen.getByLabelText(text.field).props.accessibilityHint).toContain(text.validation[validation]);
  expect(screen.getByTestId('draft-editor-notice')).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('reveals validation after layout and keyboard events without announcing private wording', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const scrollTo = jest.fn();
  try {
    open({ ...initial, validation: 'too-long', text: 'PRIVATE_FICTIONAL_WORDING' });
    screen.UNSAFE_getByType(Screen).props.scrollViewRef.current = { scrollTo };
    fireEvent(screen.getByTestId('draft-editor-form'), 'layout', { nativeEvent: { layout: { y: 100 } } });
    fireEvent(screen.getByTestId('draft-editor-notice'), 'layout', { nativeEvent: { layout: { y: 40 } } });
    expect(scrollTo).toHaveBeenCalled(); expect(announce).toHaveBeenCalledWith(draftEditingCopy.en.validation['too-long']);
    expect(announce.mock.calls.flat().join(' ')).not.toContain('PRIVATE_FICTIONAL_WORDING');
  } finally { announce.mockRestore(); }
});

it.each(['loading', 'saving', 'uncertain', 'conflict', 'error'] as const)('does not allow ordinary edits or automatic saves while %s', phase => {
  const actions = open({ ...initial, phase, compare: phase === 'conflict' ? { ...draft, revision: 2, content: 'Remote wording.' } : undefined });
  const input = screen.queryByLabelText(draftEditingCopy.en.field);
  if (input) {
    expect(input.props.editable).toBe(false); fireEvent.changeText(input, 'Unwanted change');
  }
  expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: draftEditingCopy.en.save })).toBeNull();
});

it('requires checking an uncertain save before offering its retry', () => {
  const actions = open({ ...initial, phase: 'uncertain', error: 'network', canRetry: false });
  const text = draftEditingCopy.en; expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull(); tap(text.check);
  expect(actions.onCheck).toHaveBeenCalledTimes(1); expect(actions.onRetry).not.toHaveBeenCalled();
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('retries only the reconciled frozen save when explicitly requested', () => {
  const actions = open({ ...initial, phase: 'uncertain', canRetry: true }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.retryHelp)).toBeOnTheScreen(); tap(text.retry); tap(text.retry);
  expect(actions.onRetry).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it('separates local and saved conflict wording and requires explicit reconciliation', () => {
  const actions = open({ ...initial, phase: 'conflict', text: 'My local wording.',
    compare: { ...draft, revision: 2, content: 'Current remote wording.' } }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.local)).toBeOnTheScreen(); expect(screen.getByText(text.remote)).toBeOnTheScreen();
  expect(screen.getByLabelText(text.field).props.value).toBe('My local wording.');
  expect(screen.getByText('Current remote wording.')).toBeOnTheScreen();
  expect(actions.onKeepMine).not.toHaveBeenCalled(); expect(actions.onUseLatest).not.toHaveBeenCalled();
  tap(text.keepMine); expect(actions.onKeepMine).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
  tap(text.useLatest); expect(actions.onUseLatest).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires another read if conflict comparison has not loaded', () => {
  const actions = open({ ...initial, phase: 'conflict' }); const text = draftEditingCopy.en;
  expect(screen.queryByRole('button', { name: text.keepMine })).toBeNull();
  expect(screen.queryByRole('button', { name: text.useLatest })).toBeNull(); tap(text.check);
  expect(actions.onCheck).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(Object.keys(draftEditingCopy.en.errors) as StoryProjectsErrorKind[])('renders only translated safe %s failure copy', error => {
  open({ ...initial, phase: 'error', error }, 'sv'); expect(screen.getByRole('alert')).toHaveTextContent(draftEditingCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|PRIVATE_SERVER_REASON/)).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides private content and editing controls after %s', error => {
  const actions = open({ ...initial, phase: 'error', error, text: 'PRIVATE_FICTIONAL_WORDING', compare: draft, canRetry: true });
  const text = draftEditingCopy.en;
  expect(screen.queryByText('Fictional story')).toBeNull(); expect(screen.queryByDisplayValue('PRIVATE_FICTIONAL_WORDING')).toBeNull();
  expect(screen.queryByLabelText(text.field)).toBeNull(); expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  expect(screen.queryByRole('button', { name: text.check })).toBeNull(); tap(text.back); tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});

it('shows success only when an actual saved draft is supplied by the controller', () => {
  open({ ...initial, phase: 'saved', draft: null }); expect(screen.queryByText(draftEditingCopy.en.saved)).toBeNull();
});

it.each(['en', 'sv'] as const)('leaves dirty navigation decisions to the controller in %s', language => {
  const actions = open(initial, language); const text = draftEditingCopy[language]; tap(text.back); tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
  expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('preserves native accessibility, large touch targets and scalable text', () => {
  open(initial, 'en', 'sv');
  expect(screen.getByLabelText(draftEditingCopy.en.field).props.accessibilityLanguage).toBe('sv-SE');
  const keyboardLayout = screen.UNSAFE_getByType(KeyboardAvoidingView);
  expect(keyboardLayout.props.behavior).toBe('padding');
  expect(StyleSheet.flatten(keyboardLayout.props.style)).toMatchObject({ flex: 1 });
  for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
  const input = screen.UNSAFE_getByType(TextInput); expect(input.props.allowFontScaling).toBe(true); expect(input.props.maxLength).toBeUndefined();
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});

it('allows a deliberate further edit after save without another automatic save', () => {
  const actions = open({ ...initial, phase: 'saved', dirty: false });
  const input = screen.getByLabelText(draftEditingCopy.en.field); expect(input.props.editable).toBe(true);
  expect(screen.getByRole('button', { name: draftEditingCopy.en.save })).toBeDisabled();
  fireEvent.changeText(input, 'A later deliberate wording change.');
  expect(actions.onChangeText).toHaveBeenCalledWith('A later deliberate wording change.'); expect(actions.onSave).not.toHaveBeenCalled();
});

it('reannounces an unchanged validation error on another deliberate Save attempt', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    const actions = open({ ...initial, validation: 'required', text: ' ' }); announce.mockClear();
    tap(draftEditingCopy.en.save); expect(announce).toHaveBeenCalledWith(draftEditingCopy.en.validation.required);
    expect(actions.onSave).toHaveBeenCalledTimes(1);
  } finally { announce.mockRestore(); }
});
