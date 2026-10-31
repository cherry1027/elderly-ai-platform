import { nativeNode, nativeNodes, nativeRef, nativeText } from './native-tree';
import { getComponent } from './component-probe';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import { StoryDraftScreen, type DraftScreenState } from '../src/generation/StoryDraftScreen';
import { DraftEditorScreen, type DraftEditingState } from '../src/generation/DraftEditorScreen';
import { DraftHistoryScreen } from '../src/generation/DraftHistoryScreen';
import { GenerationBrowserScreen } from '../src/generation/GenerationBrowserScreen';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import { generationBrowserCopy } from '../src/generation/generation-browser-copy';
import { colors } from '../src/theme';
import { Screen } from '../src/components/Screen';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});

const saved: StoryDraft = {
  draft_id: '20000000-0000-4000-8000-000000000004', project_id: '10000000-0000-4000-8000-000000000001',
  version: 4, revision: 2, language: 'en', style: 'warm', mode: 'mock', status: 'edited',
  content: 'My fictional childhood.\n\n  A second paragraph, in my own words.', original_content: 'My fictional childhood.',
  source_memories: [{ memory_id: '40000000-0000-4000-8000-000000000001', memory_version: 1,
    source_message_id: '30000000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
    evidence: 'A fictional memory of Malmö.', corrected_value: null, year: null, slot: 'grew_up_location', sentence: 'I grew up in Malmö.' }],
  verification: { status: 'needs_review', method: 'manual_unverified', unsupported_claims: [], checked_revision: 2,
    checked_at: '2026-10-24T10:00:00Z', sources_current: true, reason: 'Private review reason' },
  created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T10:00:00Z',
};
function readerActions() {
  return { onGenerate: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn(), onReviewMemories: jest.fn(),
    onBack: jest.fn(), onSignOut: jest.fn(), onEdit: jest.fn(), onHistory: jest.fn(), onExport: jest.fn(),
    onContinueStory: jest.fn(), onGenerations: jest.fn(), onPreviousGeneration: jest.fn() };
}
const readerState: DraftScreenState = { phase: 'ready', draft: saved, verification: null, canRetry: false };

it.each(['en', 'sv'] as const)('B4 reader separates primary editing, continued memories and secondary actions in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  await render(<StoryDraftScreen language={language} storyLanguage="en" title="Fictional childhood" state={readerState} {...actions} />);
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  const edit = within(screen.getByTestId('autobiography-primary-action')).getByRole('button', { name: text.edit });
  expect(edit).toHaveStyle({ backgroundColor: colors.forest, minHeight: 56 });
  expect(within(screen.getByTestId('autobiography-continue-action')).getByRole('button', { name: text.continueStory })).toBeOnTheScreen();
  const secondary = within(screen.getByTestId('autobiography-saved-actions'));
  for (const label of [text.generations, text.history, text.export]) expect(secondary.getByRole('button', { name: label })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.generateAgain })).toHaveStyle({ backgroundColor: colors.paper });
  expect(screen.getByText(text.statuses.needs_review)).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByText(text.readerHelp)).toBeOnTheScreen();
  const wording = screen.getByTestId('autobiography-saved-wording');
  expect(wording.props.children).toBe(saved.content);
  expect(wording.props.accessibilityLanguage).toBe('en-GB');
  expect(wording).toHaveStyle({ fontSize: 24, lineHeight: 40 });
  expect(screen.getByText(`${text.generation}: 4`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.revision}: 2`)).toBeOnTheScreen();
  expect(screen.getByText(text.generationHelp)).toBeOnTheScreen();
  for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 saved wording precedes secondary controls and explanatory copy in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  await render(<StoryDraftScreen language={language} storyLanguage="en" title="Fictional childhood" state={readerState} {...actions} />);
  const visibleText = nativeNodes('text').map(nativeText);
  const wording = visibleText.indexOf(saved.content);
  expect(wording).toBeGreaterThan(-1);
  for (const label of [text.simulation, `${text.generation}: 4`, `${text.revision}: 2`, text.statuses.needs_review, text.edit]) {
    expect(visibleText.indexOf(label)).toBeGreaterThan(-1);
    expect(visibleText.indexOf(label)).toBeLessThan(wording);
  }
  for (const label of [text.continueStory, text.introduction, text.simulationHelp, text.generationHelp,
    text.readerHelp, text.verificationHelp, text.showSources, text.savedActions, text.generationActions, text.memoryActions]) {
    expect(visibleText.indexOf(label)).toBeGreaterThan(wording);
  }
  expect(screen.getByTestId('autobiography-review-warnings')).toHaveTextContent(text.statuses.needs_review);
  expect(screen.getByTestId('autobiography-saved-wording')).toHaveStyle({ fontSize: 24, lineHeight: 40 });
  expect(screen.getAllByRole('button', { name: text.edit })).toHaveLength(1);
  for (const control of screen.getAllByRole('button')) expect(control).toHaveStyle({ minHeight: 56 });
  for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each((['en', 'sv'] as const).flatMap(language => (['manual', 'stale', 'unsupported', 'unmatched'] as const).map(kind => ({ language, kind }))))(
  'B4 keeps $kind review warnings before saved wording in $language without opening a disclosure', async ({ language, kind }) => {
    const actions = readerActions(), text = storyGenerationCopy[language];
    const draft: StoryDraft = kind === 'stale' ? { ...saved, verification: { ...saved.verification, status: 'stale_sources', sources_current: false } }
      : kind === 'unsupported' ? { ...saved, verification: { ...saved.verification, unsupported_claims: ['Synthetic unsupported claim'] } }
        : saved;
    const verification = kind === 'unmatched' ? { project_id: saved.project_id,
      draft_id: '20000000-0000-4000-8000-000000000099', version: saved.version, revision: saved.revision,
      verification: saved.verification } : null;
    await render(<StoryDraftScreen language={language} storyLanguage="en" title="Fictional childhood"
      state={{ ...readerState, draft, verification }} {...actions} />);
    const warning = kind === 'manual' ? text.statuses.needs_review : kind === 'stale' ? text.sourcesChanged
      : kind === 'unsupported' ? text.unsupportedWarning : text.verificationUnavailable;
    expect(screen.getByTestId('autobiography-review-warnings')).toHaveTextContent(warning, { exact: false });
    const visibleText = nativeNodes('text').map(nativeText);
    expect(visibleText.indexOf(warning)).toBeGreaterThan(-1);
    expect(visibleText.indexOf(warning)).toBeLessThan(visibleText.indexOf(saved.content));
    expect(screen.getByRole('button', { name: text.showSources }).props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText('Synthetic unsupported claim')).toBeNull();
    for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

it.each(['en', 'sv'] as const)('B4 an unmatched report does not hide selected-draft warnings in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  const draft = { ...saved, verification: { ...saved.verification, sources_current: false,
    unsupported_claims: ['Synthetic unsupported claim'] } };
  const verification = { project_id: saved.project_id, draft_id: '20000000-0000-4000-8000-000000000099',
    version: saved.version, revision: saved.revision, verification: saved.verification };
  await render(<StoryDraftScreen language={language} storyLanguage="en" title="Fictional childhood"
    state={{ ...readerState, draft, verification }} {...actions} />);
  const visibleText = nativeNodes('text').map(nativeText);
  for (const warning of [text.verificationUnavailable, text.statuses.needs_review, text.sourcesChanged, text.unsupportedWarning]) {
    expect(visibleText.indexOf(warning)).toBeGreaterThan(-1);
    expect(visibleText.indexOf(warning)).toBeLessThan(visibleText.indexOf(saved.content));
  }
  expect(screen.queryByText(text.statuses.passed)).toBeNull();
  expect(screen.getByRole('button', { name: text.showSources }).props.accessibilityState).toMatchObject({ expanded: false });
  for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 reader sources and organized read-only destinations do not create another autobiography in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  await render(<StoryDraftScreen language={language} storyLanguage="en" title="Fictional childhood" state={readerState} {...actions} />);
  await fireEvent.press(screen.getByRole('button', { name: text.showSources }));
  expect(screen.getByText(saved.source_memories[0].evidence)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.hideSources }));
  for (const [label, callback] of [[text.generations, actions.onGenerations], [text.history, actions.onHistory],
    [text.export, actions.onExport], [text.continueStory, actions.onContinueStory], [text.edit, actions.onEdit]] as const) {
    await fireEvent.press(screen.getByRole('button', { name: label })); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(actions.onGenerate).not.toHaveBeenCalled(); expect(actions.onRetry).not.toHaveBeenCalled();
  expect(actions.onRefresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 explicit generation preserves any older returned selection and never invents a generation number in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  const props = { language, storyLanguage: 'en' as const, title: 'Fictional childhood', ...actions };
  const view = await render(<StoryDraftScreen {...props} state={readerState} />);
  await fireEvent.press(screen.getByRole('button', { name: text.generateAgain }));
  expect(screen.getByText(text.confirmation)).toBeOnTheScreen();
  expect(actions.onGenerate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.cancel }));
  expect(actions.onGenerate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: text.generateAgain }));
  await fireEvent.press(screen.getByRole('button', { name: text.confirm }));
  expect(actions.onGenerate).toHaveBeenCalledTimes(1);
  const reused = { ...saved, draft_id: '20000000-0000-4000-8000-000000000001', version: 1, revision: 5 };
  await view.rerender(<StoryDraftScreen {...props} state={{ ...readerState, draft: reused, notice: 'saved', previousGeneration: { draftId: saved.draft_id, version: 4 } }} />);
  expect(screen.getByText(`${text.generation}: 1`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.revision}: 5`)).toBeOnTheScreen();
  expect(screen.queryByText(`${text.generation}: 5`)).toBeNull();
  expect(screen.getByText(text.saved)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.openPreviousGeneration }));
  expect(actions.onPreviousGeneration).toHaveBeenCalledTimes(1); expect(actions.onGenerate).toHaveBeenCalledTimes(1);
});

it.each(['en', 'sv'] as const)('B4 reader empty and uncertain entry keep honest state and generation explicit in %s', async language => {
  const actions = readerActions(), text = storyGenerationCopy[language];
  const props = { language, storyLanguage: 'en' as const, title: 'Fictional childhood', ...actions };
  const view = await render(<StoryDraftScreen {...props} state={{ ...readerState, draft: null }} />);
  expect(screen.getByText(text.noDraft)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: text.continueStory })).toBeNull();
  expect(actions.onGenerate).not.toHaveBeenCalled();
  await view.rerender(<StoryDraftScreen {...props} state={{ ...readerState, phase: 'uncertain', error: 'timeout' }} />);
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors.timeout);
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.generateAgain })).toBeNull();
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(actions.onGenerate).not.toHaveBeenCalled(); expect(actions.onRetry).not.toHaveBeenCalled();
});

it.each((['en', 'sv'] as const).flatMap(language => (['ios', 'android'] as const).map(platform => ({ language, platform }))))(
  'B4 editor keeps keyboard-aware native input, unsaved status and explicit Save in $language on $platform', async ({ language, platform }) => {
    const os = jest.replaceProperty(Platform, 'OS', platform);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const text = draftEditingCopy[language], value = '  Fictional paragraph.\n\n  Exact user wording.  ';
    const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
      onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
    const state: DraftEditingState = { phase: 'editing', draft: saved, text: value, dirty: true, canRetry: false };
    try {
      await render(<DraftEditorScreen language={language} storyLanguage="en" title="Fictional childhood" state={state} {...actions} />);
      const layout = getComponent(KeyboardAvoidingView);
      expect(layout.props.enabled).toBe(platform !== 'ios');
      expect(nativeNode('scroll').props.automaticallyAdjustKeyboardInsets).toBe(platform === 'ios');
      expect(screen.getByTestId('autobiography-editor-status')).toHaveTextContent(text.unsavedStatus, { exact: false });
      expect(screen.getByTestId('autobiography-editor-status')).toHaveTextContent(`${text.generation}: 4`, { exact: false });
      expect(screen.getByTestId('autobiography-editor-status')).toHaveTextContent(`${text.selectedRevision}: 2`, { exact: false });
      const input = screen.getByLabelText(text.field);
      await fireEvent(input, 'submitEditing'); await fireEvent(input, 'blur');
      await fireEvent.press(screen.getByRole('button', { name: text.done }));
      expect(dismiss).toHaveBeenCalled(); expect(input.props.value).toBe(value);
      expect(actions.onSave).not.toHaveBeenCalled(); expect(actions.onChangeText).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: text.save }));
      expect(actions.onSave).toHaveBeenCalledTimes(1);
      expect(input.props.value).toBe(value);
      for (const control of screen.getAllByRole('button')) expect(control).toHaveStyle({ minHeight: 56 });
      for (const node of nativeNodes('text')) {
        expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
        expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
      }
    } finally { dismiss.mockRestore(); os.restore(); }
  });

it.each(['en', 'sv'] as const)('B4 browser identifies selected saved generation independently of its text revision in %s', async language => {
  const text = generationBrowserCopy[language], onOpen = jest.fn();
  await render(<GenerationBrowserScreen language={language} storyLanguage="en" title="Fictional childhood" selectedDraftId={saved.draft_id}
    state={{ phase: 'ready', items: [saved], hasMore: true, bounded: false }} onOpen={onOpen} onLoadMore={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} />);
  expect(screen.getByTestId('saved-autobiography-selection').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText(text.selected)).toBeOnTheScreen(); expect(screen.getByText(text.incomplete)).toBeOnTheScreen();
  expect(screen.getByText(`${text.generation}: 4`)).toBeOnTheScreen(); expect(screen.getByText(`${text.revision}: 2`)).toBeOnTheScreen();
  expect(screen.queryByText(saved.content)).toBeNull(); expect(onOpen).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each((['en', 'sv'] as const).flatMap(language => (['saving', 'uncertain', 'conflict'] as const).map(phase => ({ language, phase }))))(
  'B4 editor does not claim a confirmed saved or canceled result while $phase in $language', async ({ language, phase }) => {
    const text = draftEditingCopy[language];
    const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
      onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
    await render(<DraftEditorScreen language={language} storyLanguage="en" title="Fictional childhood"
      state={{ phase, draft: saved, text: 'Unconfirmed fictional wording.', dirty: false, canRetry: false }} {...actions} />);
    expect(screen.getByTestId('autobiography-editor-status')).toHaveTextContent(text.pendingStatus, { exact: false });
    expect(screen.queryByText(text.savedStatus)).toBeNull();
    expect(screen.queryByText(text.unchanged)).toBeNull();
    expect(actions.onSave).not.toHaveBeenCalled(); expect(actions.onRetry).not.toHaveBeenCalled();
  });

it.each(['en', 'sv'] as const)('B4 browsing a newer card still identifies the older reading selection in %s', async language => {
  const text = generationBrowserCopy[language], onOpen = jest.fn();
  const newer = { ...saved, draft_id: '20000000-0000-4000-8000-000000000009', version: 9, revision: 1 };
  await render(<GenerationBrowserScreen language={language} storyLanguage="en" title="Fictional childhood" selectedDraftId={saved.draft_id}
    state={{ phase: 'ready', items: [newer, saved], hasMore: false }} onOpen={onOpen} onLoadMore={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onSignOut={jest.fn()} />);
  expect(screen.getByText(`${text.selectionContext}: ${text.generation} 4 · ${text.revision} 2`)).toBeOnTheScreen();
  expect(screen.getByTestId('saved-autobiography-selection').props.accessibilityState).toEqual({ selected: false });
  expect(onOpen).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 edit history makes one generation and its revision audit distinct without a restore action in %s', async language => {
  const text = draftEditingCopy[language], onLoadMore = jest.fn(), onRefresh = jest.fn();
  await render(<DraftHistoryScreen language={language} storyLanguage="en" title="Fictional childhood" state={{ phase: 'ready', draft: saved,
    items: [{ id: '50000000-0000-4000-8000-000000000001', draft_id: saved.draft_id, revision: 2,
      content: saved.content, previous_content: saved.original_content, created_at: saved.updated_at }], hasMore: false }}
    onLoadMore={onLoadMore} onRefresh={onRefresh} onBack={jest.fn()} onSignOut={jest.fn()} />);
  expect(screen.getByRole('header', { name: text.historyTitle })).toBeOnTheScreen();
  expect(screen.getByText(text.historySeparation)).toBeOnTheScreen();
  expect(screen.getByText(`${text.generation}: 4`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.selectedRevision}: 2`)).toBeOnTheScreen();
  expect(screen.getByText(saved.content)).toBeOnTheScreen();
  expect(screen.getByText(saved.original_content)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /restore|återställ|merge|slå ihop/i })).toBeNull();
  expect(onLoadMore).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('B4 editor error layout yields to native focus with the keyboard visible in %s', async language => {
  const text = draftEditingCopy[language], visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const actions = { onChangeText: jest.fn(), onSave: jest.fn(), onCheck: jest.fn(), onRetry: jest.fn(),
    onUseLatest: jest.fn(), onKeepMine: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  try {
    await render(<DraftEditorScreen language={language} storyLanguage="en" title="Fictional childhood"
      state={{ phase: 'editing', draft: saved, text: saved.content, dirty: true, canRetry: false, validation: 'too-long' }} {...actions} />);
    const scroll = nativeRef(getComponent(Screen).props.scrollViewRef);
    const scrollTo = jest.spyOn(scroll, 'scrollTo');
    const focusScroll = jest.spyOn(scroll, 'scrollResponderScrollNativeHandleToKeyboard');
    await fireEvent(nativeNode('scroll'), 'focus', { nativeEvent: { target: 77 } });
    expect(focusScroll).toHaveBeenCalledWith(77, 16, true);
    await fireEvent(screen.getByTestId('draft-editor-notice'), 'layout', { nativeEvent: { layout: { y: 80 } } });
    expect(scrollTo).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(text.validation['too-long']);
    visible.mockReturnValue(false);
    await fireEvent(screen.getByTestId('draft-editor-form'), 'layout', { nativeEvent: { layout: { y: 160 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 224, animated: false });
    expect(actions.onSave).not.toHaveBeenCalled(); expect(actions.onChangeText).not.toHaveBeenCalled();
  } finally { visible.mockRestore(); dismiss.mockRestore(); }
});
