import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { GenerationBrowserScreen, type GenerationBrowserState } from '../src/generation/GenerationBrowserScreen';
import { generationBrowserCopy } from '../src/generation/generation-browser-copy';

const newest = { draft_id: '30000000-0000-4000-8000-000000000003', version: 3, revision: 1,
  content: 'Private saved prose.', verification: { method: 'deterministic_mock_v1', sources_current: true } } as StoryDraft;
const older = { ...newest, draft_id: '30000000-0000-4000-8000-000000000001', version: 1, revision: 4,
  verification: { ...newest.verification, method: 'manual_unverified' } } as StoryDraft;
const initial: GenerationBrowserState = { phase: 'ready', items: [newest, older], hasMore: false };
function open(state = initial, language: 'en' | 'sv' = 'en') {
  const actions = { onOpen: jest.fn(), onLoadMore: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  const props = { language, storyLanguage: 'en' as const, title: 'Fictional memories', selectedDraftId: older.draft_id, state, ...actions };
  return { ...render(<GenerationBrowserScreen {...props} />), ...actions, props };
}
function tap(label: string) { fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('distinguishes generations from manual revisions without disclosing private prose in %s', language => {
  const actions = open(initial, language), text = generationBrowserCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.introduction)).toBeOnTheScreen(); expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.getByText(`${text.generation}: 3`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.revision}: 1`)).toBeOnTheScreen();
  expect(screen.queryByText(newest.content)).toBeNull(); expect(actions.onOpen).not.toHaveBeenCalled();
  tap(text.next); expect(screen.getByText(`${text.generation}: 1`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.revision}: 4`)).toBeOnTheScreen(); expect(screen.getByText(text.selected)).toBeOnTheScreen();
  expect(screen.getByText(`${text.verification}: ${text.manual}`)).toBeOnTheScreen();
  tap(text.open); tap(text.open); expect(actions.onOpen).toHaveBeenCalledTimes(1);
  expect(actions.onOpen).toHaveBeenCalledWith(older.draft_id);
});
it.each(['loading', 'checking'] as const)('has accessible %s progress and disables writes/selections', phase => {
  const actions = open({ ...initial, phase }), text = generationBrowserCopy.en;
  expect(screen.getByText(text[phase])).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  const button = screen.queryByRole('button', { name: text.open }); if (button) expect(button).toBeDisabled();
  expect(actions.onOpen).not.toHaveBeenCalled();
});
it('shows actual empty, incomplete and bounded states without inventing generations', () => {
  const actions = open({ ...initial, items: [], hasMore: true }), text = generationBrowserCopy.en;
  expect(screen.getByText(text.empty)).toBeOnTheScreen(); expect(screen.getByText(text.incomplete)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.open })).toBeNull();
  tap(text.more); expect(actions.onLoadMore).toHaveBeenCalledTimes(1);
  actions.rerender(<GenerationBrowserScreen {...actions.props} state={{ ...initial, bounded: true, hasMore: true }} />);
  expect(screen.getByText(text.bounded)).toBeOnTheScreen(); expect(screen.queryByRole('button', { name: text.more })).toBeNull();
});
it.each(Object.keys(generationBrowserCopy.en.errors) as StoryProjectsErrorKind[])('shows a safe %s error without allowing stale selection', error => {
  const actions = open({ ...initial, phase: 'error', error }, 'sv'), text = generationBrowserCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors[error]);
  const button = screen.queryByRole('button', { name: text.open }); if (button) expect(button).toBeDisabled();
  expect(actions.onOpen).not.toHaveBeenCalled(); expect(screen.queryByText(/Bearer|access_token|PRIVATE_REASON/)).toBeNull();
});
it.each(['authentication', 'forbidden', 'not-found'] as const)('hides private list information after %s', error => {
  const actions = open({ ...initial, phase: 'error', error, hasMore: true }), text = generationBrowserCopy.en;
  expect(screen.queryByText('Fictional memories')).toBeNull(); expect(screen.queryByText(`${text.generation}: 3`)).toBeNull();
  expect(screen.queryByRole('button', { name: text.open })).toBeNull();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  tap(text.back); tap(text.signOut); expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});
it('keeps the browsed generation in view when a page is appended', () => {
  const actions = open({ ...initial, hasMore: true }), text = generationBrowserCopy.en;
  tap(text.next); actions.rerender(<GenerationBrowserScreen {...actions.props}
    state={{ ...initial, items: [...initial.items, { ...older, draft_id: 'other', version: 0 }] }} />);
  expect(screen.getByText(`${text.generation}: 1`)).toBeOnTheScreen();
});
it('announces list positions rather than private content on next/previous', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    open(); announce.mockClear(); tap(generationBrowserCopy.en.next);
    expect(announce).toHaveBeenCalledWith('Saved autobiography 2 of 2');
    expect(announce).not.toHaveBeenCalledWith(newest.content);
  } finally { announce.mockRestore(); }
});
it('uses 56-unit controls, scalable text, explicit language and no restore/generation actions', () => {
  open(initial, 'sv');
  expect(screen.getByText('Fictional memories').props.accessibilityLanguage).toBe('en-GB');
  for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
  }
  expect(screen.queryByRole('button', { name: /restore|generate|export|merge/i })).toBeNull();
});
