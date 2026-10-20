import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import type { StoryProject, StoryProjectsErrorKind } from '../src/api/story-projects';
import { StoryDetailsScreen, type StoryDetailsState } from '../src/screens/StoryDetailsScreen';
import { storyDetailsCopy } from '../src/story-details-copy';

const project: StoryProject = { id: '11111111-1111-4111-8111-111111111111', title: 'A synthetic memory', description: 'A made-up description.\nSecond line.',
  language: 'en', status: 'draft', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' };
function open(state: StoryDetailsState = { status: 'ready', project }, language: 'en' | 'sv' = 'en') {
  const actions = { onEdit: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  render(<StoryDetailsScreen language={language} state={state} {...actions} />);
  return actions;
}
it.each(['en', 'sv'] as const)('shows project fields and simple controls in %s', language => {
  const p = { ...project, language, title: language === 'sv' ? 'Ett påhittat minne' : project.title };
  const actions = open({ status: 'ready', project: p }, language); const text = storyDetailsCopy[language];
  expect(screen.getByRole('header', { name: p.title })).toBeOnTheScreen();
  expect(screen.getByText(p.description!)).toBeOnTheScreen();
  expect(screen.getByText(`${text.language}: ${language === 'sv' ? text.swedish : text.english}`)).toBeOnTheScreen();
  expect(screen.getByText(`${text.status}: ${text.draft}`)).toBeOnTheScreen();
  for (const [label, callback] of [[text.edit, actions.onEdit], [text.refresh, actions.onRefresh],
    [text.back, actions.onBack], [text.signOut, actions.onSignOut]] as const) {
    const button = screen.getByRole('button', { name: label }); expect(button).toHaveStyle({ minHeight: 56 });
    fireEvent.press(button); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('uses a safe unknown status label without leaking arbitrary status text', () => {
  open({ status: 'ready', project: { ...project, status: 'private-unfamiliar-status' } });
  expect(screen.getByText(`Status: ${storyDetailsCopy.en.otherStatus}`)).toBeOnTheScreen();
  expect(screen.queryByText(/private-unfamiliar-status/)).toBeNull();
});
it.each([null, ''])('handles absent description (%s)', description => {
  open({ status: 'ready', project: { ...project, description } });
  expect(screen.getByText(storyDetailsCopy.en.noDescription)).toBeOnTheScreen();
});
it('shows loading without a cached title, description or Edit action', () => {
  const actions = open({ status: 'loading' });
  expect(screen.getByText(storyDetailsCopy.en.loading)).toBeOnTheScreen();
  expect(screen.queryByText(project.title)).toBeNull();
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: storyDetailsCopy.en.refresh })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: storyDetailsCopy.en.back })); expect(actions.onBack).toHaveBeenCalled();
});
it.each(Object.keys(storyDetailsCopy.en.errors) as StoryProjectsErrorKind[])('presents sanitized %s guidance and no stale data', error => {
  open({ status: 'error', error }, 'sv'); const text = storyDetailsCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors[error]);
  expect(screen.queryByText(project.title)).toBeNull(); expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.queryByText(text.saved)).toBeNull();
  if (error === 'authentication') expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  else expect(screen.getByRole('button', { name: text.refresh })).toBeOnTheScreen();
});
it('shows and announces success only when the controller marks a confirmed update', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    open({ status: 'ready', project, saved: true });
    expect(screen.getByText(storyDetailsCopy.en.saved)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(storyDetailsCopy.en.saved);
  } finally { announce.mockRestore(); }
});
it('keeps long content scalable and unclipped without unsupported controls', () => {
  open();
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  expect(screen.queryByText(/premium|chapter|delete|PDF|recording/i)).toBeNull();
});
