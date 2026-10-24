import { getComponent } from './component-probe';
import { nativeNodes, nativeNode, nativeRef } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, StyleSheet } from 'react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import { Screen } from '../src/components/Screen';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { DraftEditorScreen, type DraftEditingState } from '../src/generation/DraftEditorScreen';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import type { Language } from '../src/i18n';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});

const draft: StoryDraft = { draft_id: '95000000-0000-4000-8000-000000000001', project_id: '95200000-0000-4000-8000-000000000001',
  status: 'ready_for_review', language: 'en', style: 'warm', version: 1, revision: 1, content: 'I grew up in Malmö.',
  original_content: 'I grew up in Malmö.', mode: 'mock', source_memories: [],
  verification: { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1', checked_revision: 1,
    checked_at: '2026-10-23T10:00:00Z', sources_current: true, reason: null },
  created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' };
const initial: DraftEditingState = { phase: 'editing', draft, text: draft.content, canRetry: false, dirty: true };
async function open(state: DraftEditingState = initial, language: Language = 'en', storyLanguage: Language = 'en') {
  const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
    onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const view = await render(<DraftEditorScreen language={language} storyLanguage={storyLanguage} title="Fictional story"
    state={state} {...actions} />);
  return { ...view, ...actions };
}
async function tap(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('shows native controlled wording without a write in %s', async language => {
  const actions = await open(initial, language); const text = draftEditingCopy[language];
  expect(screen.getByRole('header', { name: text.editorTitle })).toBeOnTheScreen();
  expect(screen.getByLabelText(text.field).props.value).toBe(draft.content);
  expect(screen.getByText(text.simulation)).toBeOnTheScreen(); expect(screen.getByText(text.preservation)).toBeOnTheScreen();
  expect(screen.getByText(text.privacy)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('retains controlled paragraphs when keyboard Done, blur and Done typing occur', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  try {
    const value = 'Jag växte upp i Malmö.\n\nDet här är min egen formulering.';
    const actions = await open({ ...initial, text: value }); const input = screen.getByLabelText(draftEditingCopy.en.field);
    await fireEvent(input, 'submitEditing', { nativeEvent: { text: value } }); await fireEvent(input, 'blur');
    await tap(draftEditingCopy.en.done);
    expect(screen.getByLabelText(draftEditingCopy.en.field).props.value).toBe(value); expect(dismiss).toHaveBeenCalled();
    expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
    expect(input.props.submitBehavior).toBe('newline'); expect(input.props.multiline).toBe(true);
  } finally { dismiss.mockRestore(); }
});

it('passes a changed paragraph to the controller without trimming or silently saving', async () => {
  const actions = await open(); const value = '  My wording.\n\n  Another paragraph.  ';
  await fireEvent.changeText(screen.getByLabelText(draftEditingCopy.en.field), value);
  expect(actions.onChangeText).toHaveBeenCalledWith(value); expect(actions.onSave).not.toHaveBeenCalled();
});

it('saves only after explicit action and blocks a repeated tap before controller state changes', async () => {
  const actions = await open(); await tap(draftEditingCopy.en.save); await tap(draftEditingCopy.en.save);
  expect(actions.onSave).toHaveBeenCalledTimes(1); expect(actions.onCheck).not.toHaveBeenCalled();
});

it('does not invite an unnecessary save when no wording changed', async () => {
  const actions = await open({ ...initial, dirty: false });
  expect(screen.getByRole('button', { name: draftEditingCopy.en.save })).toBeDisabled();
  expect(screen.getByText(draftEditingCopy.en.unchanged)).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(['required', 'too-long', 'invalid'] as const)('shows visible, accessible %s validation in both field hint and notice', async validation => {
  const actions = await open({ ...initial, validation }, 'sv'); const text = draftEditingCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.validation[validation]);
  expect(screen.getByLabelText(text.field).props.accessibilityHint).toContain(text.validation[validation]);
  expect(screen.getByTestId('draft-editor-notice')).toBeOnTheScreen(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('reveals validation after layout and keyboard events without announcing private wording', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const scrollTo = jest.fn();
  try {
    await open({ ...initial, validation: 'too-long', text: 'PRIVATE_FICTIONAL_WORDING' });
    jest.spyOn(nativeRef(getComponent(Screen).props.scrollViewRef), 'scrollTo').mockImplementation(scrollTo);
    await fireEvent(screen.getByTestId('draft-editor-form'), 'layout', { nativeEvent: { layout: { y: 100 } } });
    await fireEvent(screen.getByTestId('draft-editor-notice'), 'layout', { nativeEvent: { layout: { y: 40 } } });
    expect(scrollTo).toHaveBeenCalled(); expect(announce).toHaveBeenCalledWith(draftEditingCopy.en.validation['too-long']);
    expect(announce.mock.calls.flat().join(' ')).not.toContain('PRIVATE_FICTIONAL_WORDING');
  } finally { announce.mockRestore(); }
});

it.each(['loading', 'saving', 'uncertain', 'conflict', 'error'] as const)('does not allow ordinary edits or automatic saves while %s', async phase => {
  const actions = await open({ ...initial, phase, compare: phase === 'conflict' ? { ...draft, revision: 2, content: 'Remote wording.' } : undefined });
  const input = screen.queryByLabelText(draftEditingCopy.en.field);
  if (input) {
    expect(input.props.editable).toBe(false); await fireEvent.changeText(input, 'Unwanted change');
  }
  expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: draftEditingCopy.en.save })).toBeNull();
});

it('requires checking an uncertain save before offering its retry', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', error: 'network', canRetry: false });
  const text = draftEditingCopy.en; expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull(); await tap(text.check);
  expect(actions.onCheck).toHaveBeenCalledTimes(1); expect(actions.onRetry).not.toHaveBeenCalled();
  expect(actions.onSave).not.toHaveBeenCalled();
});

it('retries only the reconciled frozen save when explicitly requested', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', canRetry: true }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.retryHelp)).toBeOnTheScreen(); await tap(text.retry); await tap(text.retry);
  expect(actions.onRetry).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it('separates local and saved conflict wording and requires explicit reconciliation', async () => {
  const actions = await open({ ...initial, phase: 'conflict', text: 'My local wording.',
    compare: { ...draft, revision: 2, content: 'Current remote wording.' } }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.local)).toBeOnTheScreen(); expect(screen.getByText(text.remote)).toBeOnTheScreen();
  expect(screen.getByLabelText(text.field).props.value).toBe('My local wording.');
  expect(screen.getByText('Current remote wording.')).toBeOnTheScreen();
  expect(actions.onKeepMine).not.toHaveBeenCalled(); expect(actions.onUseLatest).not.toHaveBeenCalled();
  await tap(text.keepMine); expect(actions.onKeepMine).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
  await tap(text.useLatest); expect(actions.onUseLatest).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it('requires another read if conflict comparison has not loaded', async () => {
  const actions = await open({ ...initial, phase: 'conflict' }); const text = draftEditingCopy.en;
  expect(screen.queryByRole('button', { name: text.keepMine })).toBeNull();
  expect(screen.queryByRole('button', { name: text.useLatest })).toBeNull(); await tap(text.check);
  expect(actions.onCheck).toHaveBeenCalledTimes(1); expect(actions.onSave).not.toHaveBeenCalled();
});

it.each(Object.keys(draftEditingCopy.en.errors) as StoryProjectsErrorKind[])('renders only translated safe %s failure copy', async error => {
  await open({ ...initial, phase: 'error', error }, 'sv'); expect(screen.getByRole('alert')).toHaveTextContent(draftEditingCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|PRIVATE_SERVER_REASON/)).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides private content and editing controls after %s', async error => {
  const actions = await open({ ...initial, phase: 'error', error, text: 'PRIVATE_FICTIONAL_WORDING', compare: draft, canRetry: true });
  const text = draftEditingCopy.en;
  expect(screen.queryByText('Fictional story')).toBeNull(); expect(screen.queryByDisplayValue('PRIVATE_FICTIONAL_WORDING')).toBeNull();
  expect(screen.queryByLabelText(text.field)).toBeNull(); expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  expect(screen.queryByRole('button', { name: text.check })).toBeNull(); await tap(text.back); await tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});

it('shows success only when an actual saved draft is supplied by the controller', async () => {
  await open({ ...initial, phase: 'saved', draft: null }); expect(screen.queryByText(draftEditingCopy.en.saved)).toBeNull();
});

it.each(['en', 'sv'] as const)('leaves dirty navigation decisions to the controller in %s', async language => {
  const actions = await open(initial, language); const text = draftEditingCopy[language]; await tap(text.back); await tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
  expect(actions.onChangeText).not.toHaveBeenCalled(); expect(actions.onSave).not.toHaveBeenCalled();
});

it('preserves native accessibility, large touch targets and scalable text', async () => {
  await open(initial, 'en', 'sv');
  expect(screen.getByLabelText(draftEditingCopy.en.field).props.accessibilityLanguage).toBe('sv-SE');
  const keyboardLayout = getComponent(KeyboardAvoidingView);
  expect(keyboardLayout.props.behavior).toBe('padding');
  expect(StyleSheet.flatten(keyboardLayout.props.style)).toMatchObject({ flex: 1 });
  for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
  const input = nativeNode('input'); expect(input.props.allowFontScaling).toBe(true); expect(input.props.maxLength).toBeUndefined();
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});

it('allows a deliberate further edit after save without another automatic save', async () => {
  const actions = await open({ ...initial, phase: 'saved', dirty: false });
  const input = screen.getByLabelText(draftEditingCopy.en.field); expect(input.props.editable).toBe(true);
  expect(screen.getByRole('button', { name: draftEditingCopy.en.save })).toBeDisabled();
  await fireEvent.changeText(input, 'A later deliberate wording change.');
  expect(actions.onChangeText).toHaveBeenCalledWith('A later deliberate wording change.'); expect(actions.onSave).not.toHaveBeenCalled();
});

it('reannounces an unchanged validation error on another deliberate Save attempt', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    const actions = await open({ ...initial, validation: 'required', text: ' ' }); announce.mockClear();
    await tap(draftEditingCopy.en.save); expect(announce).toHaveBeenCalledWith(draftEditingCopy.en.validation.required);
    expect(actions.onSave).toHaveBeenCalledTimes(1);
  } finally { announce.mockRestore(); }
});
