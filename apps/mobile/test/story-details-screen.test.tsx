import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import { StoryDetailsScreen, type StoryDetailsState } from '../src/screens/StoryDetailsScreen';
import { storyDetailsCopy } from '../src/story-details-copy';

const project: StoryProject = { id: '11111111-1111-4111-8111-111111111111', title: 'A synthetic memory', description: 'A made-up description.\nSecond line.',
  language: 'en', status: 'draft', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' };
async function open(state: StoryDetailsState = { status: 'ready', project }, language: 'en' | 'sv' = 'en') {
  const actions = { onEdit: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  await render(<StoryDetailsScreen language={language} state={state} {...actions} />);
  return actions;
}
it.each(['en', 'sv'] as const)('shows project fields and simple controls in %s', async language => {
  const p = { ...project, language, title: language === 'sv' ? 'Ett påhittat minne' : project.title };
  const actions = await open({ status: 'ready', project: p }, language); const text = storyDetailsCopy[language];
  expect(screen.getByRole('header', { name: p.title })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: text.signOut })).toBeNull();
  expect(screen.queryByText(`${text.language}: ${language === 'sv' ? text.swedish : text.english}`)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: text.more }));
  expect(screen.getByText(p.description!)).toBeOnTheScreen();
  expect(screen.getByText(`${text.language}: ${language === 'sv' ? text.swedish : text.english}`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.status}: ${text.draft}`)).toBeOnTheScreen();
  for (const [label, callback] of [[text.edit, actions.onEdit], [text.refresh, actions.onRefresh],
    [text.back, actions.onBack], [text.signOut, actions.onSignOut]] as const) {
    const button = screen.getByRole('button', { name: label }); expect(button).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(button); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('uses a safe unknown status label without leaking arbitrary status text', async () => {
  await open({ status: 'ready', project: { ...project, status: 'private-unfamiliar-status' } });
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  expect(screen.getByText(`Status: ${storyDetailsCopy.en.otherStatus}`)).toBeOnTheScreen();
  expect(screen.queryByText(/private-unfamiliar-status/)).toBeNull();
});
it.each([null, ''])('handles absent description (%s)', async description => {
  await open({ status: 'ready', project: { ...project, description } });
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.more }));
  expect(screen.getByText(storyDetailsCopy.en.noDescription)).toBeOnTheScreen();
});
it('shows loading without a cached title, description or Edit action', async () => {
  const actions = await open({ status: 'loading' });
  expect(screen.getByText(storyDetailsCopy.en.loading)).toBeOnTheScreen();
  expect(screen.queryByText(project.title)).toBeNull();
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.refresh })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.back })); expect(actions.onBack).toHaveBeenCalled();
});
it.each(Object.keys(storyDetailsCopy.en.errors) as StoryProjectsErrorKind[])('presents sanitized %s guidance and no stale data', async error => {
  await open({ status: 'error', error }, 'sv'); const text = storyDetailsCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors[error]);
  expect(screen.queryByText(project.title)).toBeNull(); expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.queryByText(text.saved)).toBeNull();
  if (error === 'authentication') expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  else expect(screen.getByRole('button', { name: text.refresh })).toBeOnTheScreen();
});
it('shows and announces success only when the controller marks a confirmed update', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    await open({ status: 'ready', project, saved: true });
    expect(screen.getByText(storyDetailsCopy.en.saved)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(storyDetailsCopy.en.saved);
  } finally { announce.mockRestore(); }
});
it('keeps long content scalable and unclipped without unsupported controls', async () => {
  await open();
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  expect(screen.queryByText(/premium|chapter|delete|PDF|recording/i)).toBeNull();
});
it.each(['en', 'sv'] as const)('keeps the three %s choices clear and metadata secondary', async language => {
  const text = storyDetailsCopy[language];
  const actions = { onConversation: jest.fn(), onReviewMemories: jest.fn(), onGenerate: jest.fn(),
    onBack: jest.fn(), onEdit: jest.fn(), onRefresh: jest.fn(), onSignOut: jest.fn() };
  await render(<StoryDetailsScreen language={language} state={{ status: 'ready', project }} {...actions} />);
  expect(screen.getByText(text.introduction)).toBeOnTheScreen();
  expect(screen.queryByText(`Status: ${text.draft}`)).toBeNull();
  expect(screen.queryByText(project.description!)).toBeNull();
  for (const [label, help, callback] of [[text.conversation, text.shareHelp, actions.onConversation],
    [text.review, text.reviewHelp, actions.onReviewMemories], [text.generate, text.autobiographyHelp, actions.onGenerate]] as const) {
    expect(screen.queryByText(help)).toBeNull();
    const button = screen.getByRole('button', { name: label }); expect(button).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(button); expect(callback).toHaveBeenCalledTimes(1);
  }
  await fireEvent.press(screen.getByRole('button', { name: text.more }));
  expect(screen.getByText(project.description!)).toHaveProp('selectable', true);
  await fireEvent.press(screen.getByRole('button', { name: text.edit })); expect(actions.onEdit).toHaveBeenCalledTimes(1);
  const refresh = screen.getByRole('button', { name: text.refresh }); expect(refresh).toHaveStyle({ backgroundColor: 'transparent' });
  await fireEvent.press(refresh); expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: text.signOut })).toHaveStyle({ backgroundColor: 'transparent' });
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(actions.onBack).toHaveBeenCalledTimes(1);
});

it.each(['loading', 'authentication'] as const)('keeps direct Sign Out available for %s recovery', async kind => {
  const state: StoryDetailsState = kind === 'loading' ? { status: 'loading' } : { status: 'error', error: 'authentication' };
  const actions = await open(state);
  const signOut = screen.getByRole('button', { name: storyDetailsCopy.en.signOut });
  expect(signOut).toBeEnabled(); expect(signOut).toHaveStyle({ minHeight: 56 });
  await fireEvent.press(signOut); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
});

it.each(['en', 'sv'] as const)('gives Talk visual priority and keeps rare actions behind accessible %s options', async language => {
  const text = storyDetailsCopy[language];
  const actions = { onConversation: jest.fn(), onReviewMemories: jest.fn(), onGenerate: jest.fn(),
    onBack: jest.fn(), onEdit: jest.fn(), onRefresh: jest.fn(), onSignOut: jest.fn() };
  await render(<StoryDetailsScreen language={language} state={{ status: 'ready', project }} {...actions} />);
  const talk = screen.getByRole('button', { name: text.conversation });
  expect(talk).toHaveStyle({ minHeight: 56 });
  for (const label of [text.review, text.generate]) {
    expect(screen.getByRole('button', { name: label })).toHaveStyle({ backgroundColor: 'transparent', minHeight: 56 });
  }
  const options = screen.getByRole('button', { name: text.more });
  expect(options.props.accessibilityState.expanded).toBe(false);
  expect(options).toHaveTextContent('⋯');
  expect(screen.queryByText(text.more)).toBeNull();
  await fireEvent.press(options);
  expect(screen.getByRole('button', { name: text.more }).props.accessibilityState.expanded).toBe(true);
  expect(screen.getByRole('button', { name: text.edit })).toBeEnabled();
  expect(screen.getByRole('button', { name: text.refresh })).toBeEnabled();
  expect(screen.getByRole('button', { name: text.signOut })).toBeEnabled();
  expect(actions.onConversation).not.toHaveBeenCalled(); expect(actions.onGenerate).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
