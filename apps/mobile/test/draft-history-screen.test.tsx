import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { StoryDraft, StoryEdit } from '../src/api/story-drafts';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { DraftHistoryScreen, type DraftHistoryState } from '../src/generation/DraftHistoryScreen';
import { draftEditingCopy } from '../src/generation/draft-editing-copy';
import type { Language } from '../src/i18n';

const draft: StoryDraft = { draft_id: '95000000-0000-4000-8000-000000000001', project_id: '95200000-0000-4000-8000-000000000001',
  status: 'edited', language: 'en', style: 'warm', version: 1, revision: 3, content: 'My latest fictional wording.',
  original_content: 'I grew up in Malmö.', mode: 'mock', source_memories: [],
  verification: { status: 'needs_review', unsupported_claims: [], method: 'manual_unverified', checked_revision: 3,
    checked_at: '2026-10-23T10:00:00Z', sources_current: true, reason: null },
  created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:10:00Z' };
const newer: StoryEdit = { id: '95600000-0000-4000-8000-000000000002', draft_id: draft.draft_id, revision: 3,
  previous_content: 'My earlier fictional wording.', content: draft.content, created_at: '2026-10-23T10:10:00Z' };
const earlier: StoryEdit = { id: '95600000-0000-4000-8000-000000000001', draft_id: draft.draft_id, revision: 2,
  previous_content: draft.original_content, content: 'My earlier fictional wording.', created_at: '2026-10-23T10:05:00Z' };
const initial: DraftHistoryState = { phase: 'ready', draft, items: [newer, earlier], hasMore: false };
async function open(state: DraftHistoryState = initial, language: Language = 'en', storyLanguage: Language = 'en') {
  const actions = { onLoadMore: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  return { ...await render(<DraftHistoryScreen language={language} storyLanguage={storyLanguage} title="Fictional story"
    state={state} {...actions} />), ...actions };
}
async function tap(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('shows actual saved revision content without loading or writing automatically in %s', async language => {
  const actions = await open(initial, language); const text = draftEditingCopy[language];
  expect(screen.getByRole('header', { name: text.historyTitle })).toBeOnTheScreen();
  expect(screen.getByText(newer.content)).toBeOnTheScreen(); expect(screen.getByText(newer.previous_content)).toBeOnTheScreen();
  expect(screen.getByText(text.revision + ': 3')).toBeOnTheScreen(); expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByText(text.loadedOnly)).toBeOnTheScreen(); expect(screen.queryByText(newer.id)).toBeNull();
  expect(screen.queryByRole('button', { name: /restore|återställ/i })).toBeNull();
  expect((nativeNodes('input')[0] ?? null)).toBeNull(); expect(actions.onLoadMore).not.toHaveBeenCalled();
  expect(actions.onRefresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('shows only one stored change at a time and preserves the actual before/after relationship', async () => {
  await open(); const text = draftEditingCopy.en;
  expect(screen.getByRole('button', { name: text.previous })).toBeDisabled();
  expect(screen.queryByText(draft.original_content)).toBeNull(); await tap(text.next);
  expect(screen.getByText(text.revision + ': 2')).toBeOnTheScreen(); expect(screen.getByText(earlier.content)).toBeOnTheScreen();
  expect(screen.getByText(earlier.previous_content)).toBeOnTheScreen();
  expect(screen.queryByText(newer.content)).toBeNull(); expect(screen.getByRole('button', { name: text.next })).toBeDisabled();
  await tap(text.previous); expect(screen.getByText(newer.content)).toBeOnTheScreen();
});

it('shows immutable original revision 1 separately from returned history rows', async () => {
  await open(); const text = draftEditingCopy.en; expect(screen.queryByText(draft.original_content)).toBeNull();
  const show = screen.getByRole('button', { name: text.showOriginal }); expect(show.props.accessibilityState).toMatchObject({ expanded: false });
  await tap(text.showOriginal); expect(screen.getByRole('header', { name: text.original })).toBeOnTheScreen();
  expect(screen.getByText(draft.original_content)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.hideOriginal }).props.accessibilityState).toMatchObject({ expanded: true });
  expect(screen.getByText(text.item + ' 1 ' + text.of + ' 2')).toBeOnTheScreen();
  await tap(text.hideOriginal); expect(screen.queryByText(draft.original_content)).toBeNull();
});

it('does not invent earlier revisions or a complete list from bounded results', async () => {
  const actions = await open({ ...initial, items: [newer], hasMore: true }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.item + ' 1 ' + text.of + ' 1')).toBeOnTheScreen();
  expect(screen.queryByText(text.revision + ': 2')).toBeNull(); expect(screen.getByText(text.loadedOnly)).toBeOnTheScreen();
  await tap(text.loadMore); expect(actions.onLoadMore).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(earlier.previous_content)).toBeNull();
});

it('does not show Load earlier versions when the controller reports the end', async () => {
  await open(); expect(screen.queryByRole('button', { name: draftEditingCopy.en.loadMore })).toBeNull();
});

it('offers an honest empty state alongside the actual original draft', async () => {
  const actions = await open({ ...initial, draft: { ...draft, revision: 1 }, items: [] }); const text = draftEditingCopy.en;
  expect(screen.getByText(text.emptyHistory)).toBeOnTheScreen(); expect(screen.queryByText(newer.content)).toBeNull();
  await tap(text.showOriginal); expect(screen.getByText(draft.original_content)).toBeOnTheScreen();
  expect(screen.queryByText(text.item + ' 1 ' + text.of + ' 0')).toBeNull(); expect(actions.onLoadMore).not.toHaveBeenCalled();
});

it.each(['loading', 'loading-more'] as const)('provides an accessible %s state and blocks repeated pagination', async phase => {
  await open({ ...initial, phase, hasMore: true }); const text = draftEditingCopy.en;
  expect(screen.getByText(phase === 'loading' ? text.historyLoading : text.loadingMore)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  if (phase === 'loading-more') expect(screen.getByRole('button', { name: text.loadMore })).toBeDisabled();
  else expect(screen.queryByText(newer.content)).toBeNull();
});

it.each(Object.keys(draftEditingCopy.en.historyErrors) as StoryProjectsErrorKind[])('shows a safe translated %s history error', async error => {
  await open({ ...initial, phase: 'error', error }, 'sv'); const text = draftEditingCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.historyErrors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|PRIVATE_SERVER_REASON/)).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides all supplied private history after %s failure', async error => {
  const actions = await open({ ...initial, phase: 'error', error, hasMore: true }); const text = draftEditingCopy.en;
  expect(screen.queryByText('Fictional story')).toBeNull(); expect(screen.queryByText(newer.content)).toBeNull();
  expect(screen.queryByText(newer.previous_content)).toBeNull(); expect(screen.queryByRole('button', { name: text.showOriginal })).toBeNull();
  expect(screen.queryByRole('button', { name: text.loadMore })).toBeNull();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled(); await tap(text.back); await tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});

it('retains read-only loaded records after a non-access pagination error but requires refresh', async () => {
  const actions = await open({ ...initial, phase: 'error', error: 'network', hasMore: true }); const text = draftEditingCopy.en;
  expect(screen.getByText(newer.content)).toBeOnTheScreen(); expect(screen.getByRole('button', { name: text.loadMore })).toBeDisabled();
  await tap(text.refresh); expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onLoadMore).not.toHaveBeenCalled();
});

it('resets history disclosure when the saved draft identity or revision changes', async () => {
  const actions = await open(); const text = draftEditingCopy.en; await tap(text.showOriginal); await tap(text.next);
  await actions.rerender(<DraftHistoryScreen language="en" storyLanguage="en" title="Fictional story"
    state={{ ...initial, draft: { ...draft, revision: 4 } }} {...actions} />);
  expect(screen.queryByRole('header', { name: text.original })).toBeNull();
  expect(screen.getByText(text.item + ' 1 ' + text.of + ' 2')).toBeOnTheScreen();
});

it('announces count-only navigation and never reads private wording automatically', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    await open(); announce.mockClear(); await tap(draftEditingCopy.en.next);
    expect(announce).toHaveBeenCalledWith('Saved change 2 of 2'); expect(announce).not.toHaveBeenCalledWith(earlier.content);
    expect(announce).not.toHaveBeenCalledWith(earlier.previous_content);
  } finally { announce.mockRestore(); }
});

it.each(['en', 'sv'] as const)('has functional read-only refresh, Back and Sign Out in %s', async language => {
  const actions = await open(initial, language); const text = draftEditingCopy[language];
  await tap(text.refresh); await tap(text.back); await tap(text.signOut);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onBack).toHaveBeenCalledTimes(1);
  expect(actions.onSignOut).toHaveBeenCalledTimes(1); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('has large touch targets, dynamic text and the story content language', async () => {
  await open(initial, 'sv', 'en'); const text = draftEditingCopy.sv; await tap(text.showOriginal);
  expect(screen.getByText(draft.original_content).props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(newer.content).props.accessibilityLanguage).toBe('en-GB');
  for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});

it('clearly explains bounded history without claiming all earlier revisions were loaded', async () => {
  await open({ ...initial, bounded: true }); expect(screen.getByText(draftEditingCopy.en.historyBounded)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: draftEditingCopy.en.loadMore })).toBeNull();
});
