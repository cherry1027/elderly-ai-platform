import { nativeNodes } from './native-tree';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { StoryDraft, StoryProjectVerification, StoryVerification } from '../src/api/story-drafts';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { StoryDraftScreen, type DraftScreenState } from '../src/generation/StoryDraftScreen';
import { storyGenerationCopy } from '../src/generation/story-generation-copy';
import type { Language } from '../src/i18n';

const check: StoryVerification = { status: 'passed', unsupported_claims: [], method: 'deterministic_mock_v1',
  checked_revision: 1, checked_at: '2026-10-23T10:00:00Z', sources_current: true, reason: null };
const draft: StoryDraft = { draft_id: '95000000-0000-4000-8000-000000000001',
  project_id: '95200000-0000-4000-8000-000000000001', status: 'ready_for_review', language: 'en', style: 'warm',
  version: 1, revision: 1, content: 'I grew up in Malmö.', original_content: 'I grew up in Malmö.', mode: 'mock',
  source_memories: [{ memory_id: '95400000-0000-4000-8000-000000000001', memory_version: 2,
    source_message_id: '95300000-0000-4000-8000-000000000001', fact_type: 'location', value: 'Malmö',
    evidence: 'I grew up in Malmö in 1974.', corrected_value: 'Stockholm', year: 1974, slot: 'grew_up_location',
    sentence: 'I grew up in Stockholm.' }],
  verification: check, created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z' };
const report: StoryProjectVerification = { project_id: draft.project_id, draft_id: draft.draft_id,
  version: 1, revision: 1, verification: check };
const initial: DraftScreenState = { phase: 'ready', draft: null, verification: null, canRetry: false };
async function open(state: DraftScreenState = initial, language: Language = 'en', storyLanguage: Language = 'en') {
  const actions = { onGenerate: jest.fn(), onRetry: jest.fn(), onRefresh: jest.fn(), onReviewMemories: jest.fn(),
    onBack: jest.fn(), onSignOut: jest.fn() };
  return { ...await render(<StoryDraftScreen language={language} storyLanguage={storyLanguage} title="A fictional story"
    state={state} {...actions} />), ...actions };
}
async function tap(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('opens an honest empty preview without generating in %s', async language => {
  const actions = await open(initial, language); const text = storyGenerationCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.noDraft)).toBeOnTheScreen(); expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  expect(screen.queryByText(draft.content)).toBeNull(); expect(screen.queryByRole('button', { name: text.confirm })).toBeNull();
  expect(actions.onGenerate).not.toHaveBeenCalled(); expect(actions.onRefresh).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('requires two deliberate actions before generation in %s', async language => {
  const actions = await open(initial, language); const text = storyGenerationCopy[language];
  await tap(text.generate); expect(actions.onGenerate).not.toHaveBeenCalled();
  expect(screen.getByText(text.confirmation)).toBeOnTheScreen(); expect(screen.getByText(text.simulation)).toBeOnTheScreen();
  await tap(text.confirm); await tap(text.generate); expect(actions.onGenerate).toHaveBeenCalledTimes(1);
  expect(actions.onRetry).not.toHaveBeenCalled();
});

it('allows cancellation of confirmation without a write', async () => {
  const actions = await open(); await tap(storyGenerationCopy.en.generate); await tap(storyGenerationCopy.en.cancel);
  expect(screen.queryByText(storyGenerationCopy.en.confirmation)).toBeNull(); expect(actions.onGenerate).not.toHaveBeenCalled();
  await tap(storyGenerationCopy.en.generate); await tap(storyGenerationCopy.en.confirm); expect(actions.onGenerate).toHaveBeenCalledTimes(1);
});

it('refreshes read-only and dismisses an unsubmitted confirmation', async () => {
  const actions = await open(); const text = storyGenerationCopy.en; await tap(text.generate); await tap(text.refresh);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onGenerate).not.toHaveBeenCalled();
  expect(screen.queryByText(text.confirmation)).toBeNull();
});

it.each(['en', 'sv'] as const)('shows saved content and language without generating in %s', async language => {
  const stored = { ...draft, language, content: language === 'sv' ? 'Jag växte upp i Malmö.' : draft.content };
  const actions = await open({ ...initial, draft: stored, verification: report }, language, language);
  const text = storyGenerationCopy[language];
  expect(screen.getByText(stored.content)).toBeOnTheScreen();
  expect(screen.getByText(text.language + ': ' + (language === 'sv' ? text.swedish : text.english))).toBeOnTheScreen();
  expect(screen.getByText(text.statuses.passed)).toBeOnTheScreen(); expect(screen.getByText(text.verificationHelp)).toBeOnTheScreen();
  expect(screen.getByText(stored.content).props.accessibilityLanguage).toBe(language === 'sv' ? 'sv-SE' : 'en-GB');
  await tap(text.refresh); expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('requires confirmation before preparing another saved draft', async () => {
  const actions = await open({ ...initial, draft, verification: report }); const text = storyGenerationCopy.en;
  await tap(text.generateAgain); expect(actions.onGenerate).not.toHaveBeenCalled(); await tap(text.confirm);
  expect(actions.onGenerate).toHaveBeenCalledTimes(1); expect(screen.getByText(draft.content)).toBeOnTheScreen();
});

it.each(['loading', 'generating', 'checking'] as const)('has no active generation or retry while %s', async phase => {
  const actions = await open({ ...initial, phase, draft }); const text = storyGenerationCopy.en;
  expect(screen.getByText(text[phase])).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.generate })).toBeNull();
  expect(screen.queryByRole('button', { name: text.generateAgain })).toBeNull();
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.review })).toBeDisabled(); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('requires read-only reconciliation before offering an uncertain retry', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', draft, error: 'timeout' }); const text = storyGenerationCopy.en;
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen(); expect(screen.getByText(text.errors.timeout)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
  expect(screen.queryByRole('button', { name: text.generateAgain })).toBeNull();
  await tap(text.refresh); expect(actions.onRefresh).toHaveBeenCalledTimes(1);
  expect(actions.onRetry).not.toHaveBeenCalled(); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('offers only the retained action retry after reconciliation and prevents repeat taps', async () => {
  const actions = await open({ ...initial, phase: 'uncertain', canRetry: true }); const text = storyGenerationCopy.en;
  expect(screen.getByText(text.retryHelp)).toBeOnTheScreen(); await tap(text.retry); await tap(text.retry);
  expect(actions.onRetry).toHaveBeenCalledTimes(1); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it.each(Object.keys(storyGenerationCopy.en.codes) as (keyof typeof storyGenerationCopy.en.codes)[])('translates %s without echoing raw server errors', async code => {
  await open({ ...initial, phase: 'error', error: 'conflict', code }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(storyGenerationCopy.sv.codes[code]);
  expect(screen.queryByText(code)).toBeNull(); expect(screen.queryByText(/Bearer|access_token|refresh_token/)).toBeNull();
});

it.each(Object.keys(storyGenerationCopy.en.errors) as StoryProjectsErrorKind[])('provides a safe translated %s failure', async error => {
  await open({ ...initial, phase: 'error', error, code: 'PRIVATE_UNRECOGNIZED_MESSAGE' });
  expect(screen.getByRole('alert')).toHaveTextContent(storyGenerationCopy.en.errors[error]);
  expect(screen.queryByText('PRIVATE_UNRECOGNIZED_MESSAGE')).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides supplied private draft and title after %s', async error => {
  const actions = await open({ ...initial, phase: 'error', error, draft, verification: report, canRetry: true });
  const text = storyGenerationCopy.en;
  expect(screen.queryByText('A fictional story')).toBeNull(); expect(screen.queryByText(draft.content)).toBeNull();
  expect(screen.queryByRole('button', { name: text.showSources })).toBeNull();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.review })).toBeDisabled();
  await tap(text.back); await tap(text.signOut); expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
  expect(actions.onGenerate).not.toHaveBeenCalled();
});

it.each(['NO_CONFIRMED_MEMORIES', 'NO_SUPPORTED_MEMORIES', 'CLARIFICATION_REQUIRED', 'STORY_CONTEXT_CHANGED'])('guides %s to existing memory review', async code => {
  const actions = await open({ ...initial, phase: 'error', error: 'conflict', code }); await tap(storyGenerationCopy.en.review);
  expect(actions.onReviewMemories).toHaveBeenCalledTimes(1); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('shows source snapshots only on explicit disclosure, preserving corrections and original year separately', async () => {
  const actions = await open({ ...initial, draft, verification: report }); const text = storyGenerationCopy.en;
  expect(screen.queryByText(draft.source_memories[0].evidence)).toBeNull();
  expect(screen.getByRole('button', { name: text.showSources }).props.accessibilityState).toMatchObject({ expanded: false });
  await tap(text.showSources); expect(screen.getByText(text.original)).toBeOnTheScreen();
  expect(screen.getByText('Malmö')).toBeOnTheScreen(); expect(screen.getByText('Stockholm')).toBeOnTheScreen();
  expect(screen.getByText(text.evidence)).toBeOnTheScreen(); expect(screen.getByText(text.correction)).toBeOnTheScreen();
  expect(screen.getByText(text.year + ': 1974')).toBeOnTheScreen(); expect(screen.getByText(text.yearHelp)).toBeOnTheScreen();
  expect(screen.queryByText(draft.source_memories[0].memory_id)).toBeNull();
  expect(screen.queryByText(draft.source_memories[0].source_message_id)).toBeNull();
  await tap(text.hideSources); expect(screen.queryByText(draft.source_memories[0].evidence)).toBeNull();
  expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('discloses one source at a time and labels source text in the saved language', async () => {
  const stored = { ...draft, language: 'sv' as const, source_memories: [...draft.source_memories, {
    ...draft.source_memories[0], memory_id: '95400000-0000-4000-8000-000000000002', value: 'lärare',
    evidence: 'Jag arbetade som lärare.', corrected_value: null, year: null, sentence: 'Jag arbetade som lärare.',
  }] };
  await open({ ...initial, draft: stored }, 'en', 'sv'); const text = storyGenerationCopy.en; await tap(text.showSources);
  expect(screen.getByText(text.source + ' 1 ' + text.of + ' 2')).toBeOnTheScreen();
  expect(screen.queryByText('lärare')).toBeNull(); expect(screen.getByText('Malmö').props.accessibilityLanguage).toBe('sv-SE');
  expect(screen.getByRole('button', { name: text.previous })).toBeDisabled(); await tap(text.next);
  expect(screen.getByText('lärare')).toBeOnTheScreen(); expect(screen.queryByText('Malmö')).toBeNull();
  expect(screen.getByRole('button', { name: text.next })).toBeDisabled(); await tap(text.previous);
  expect(screen.getByText('Malmö')).toBeOnTheScreen();
});

it.each(['passed', 'needs_review', 'stale_sources', 'not_generated'] as const)('shows truthful %s verification without private reason', async status => {
  const verification = { ...check, status, reason: 'PRIVATE_BACKEND_REASON', sources_current: status === 'stale_sources' ? false : true };
  await open({ ...initial, draft: { ...draft, verification }, verification: { ...report, verification } }, 'sv');
  const text = storyGenerationCopy.sv; expect(screen.getByText(text.statuses[status])).toBeOnTheScreen();
  expect(screen.getByText(text.verificationHelp)).toBeOnTheScreen(); expect(screen.queryByText('PRIVATE_BACKEND_REASON')).toBeNull();
  if (status === 'stale_sources') expect(screen.getByText(text.sourcesChanged)).toBeOnTheScreen();
});

it('does not apply a report from a different saved draft', async () => {
  await open({ ...initial, draft, verification: { ...report, draft_id: 'another-draft' } });
  expect(screen.getByText(storyGenerationCopy.en.verificationUnavailable)).toBeOnTheScreen();
  expect(screen.queryByText(storyGenerationCopy.en.statuses.passed)).toBeNull();
});

it('does not show a passed claim for an internally conflicting report', async () => {
  await open({ ...initial, draft: { ...draft, verification: { ...check, unsupported_claims: ['Private unsupported words'] } } });
  expect(screen.getByText(storyGenerationCopy.en.verificationUnavailable)).toBeOnTheScreen();
  expect(screen.queryByText('Private unsupported words')).toBeNull(); expect(screen.queryByText(storyGenerationCopy.en.statuses.passed)).toBeNull();
});

it('never displays a success notice until the controller confirms a saved draft', async () => {
  const actions = await open(); const text = storyGenerationCopy.en; await tap(text.generate); await tap(text.confirm);
  expect(screen.queryByText(text.saved)).toBeNull();
  await actions.rerender(<StoryDraftScreen language="en" storyLanguage="en" title="A fictional story" state={{ ...initial, draft, notice: 'saved' }} {...actions} />);
  expect(screen.getByText(text.saved)).toBeOnTheScreen();
});

it('clears unsubmitted confirmation when the controller begins loading', async () => {
  const actions = await open(); const text = storyGenerationCopy.en; await tap(text.generate);
  await actions.rerender(<StoryDraftScreen language="en" storyLanguage="en" title="A fictional story" state={{ ...initial, phase: 'loading' }} {...actions} />);
  await actions.rerender(<StoryDraftScreen language="en" storyLanguage="en" title="A fictional story" state={initial} {...actions} />);
  expect(screen.queryByText(text.confirmation)).toBeNull(); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('uses large controls, dynamic text and accessible expanded state', async () => {
  await open({ ...initial, draft, verification: report }); await tap(storyGenerationCopy.en.showSources);
  for (const control of screen.getAllByRole('button')) expect(control).toHaveStyle({ minHeight: 56 });
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  expect(screen.getByRole('button', { name: storyGenerationCopy.en.hideSources }).props.accessibilityState).toMatchObject({ expanded: true });
});

it('announces safe status messages without announcing private source text', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    await open({ ...initial, phase: 'error', error: 'network', draft }); expect(announce).toHaveBeenCalledWith(storyGenerationCopy.en.errors.network);
    expect(announce).not.toHaveBeenCalledWith(draft.content); expect(announce).not.toHaveBeenCalledWith(draft.source_memories[0].evidence);
  } finally { announce.mockRestore(); }
});

it.each(['en', 'sv'] as const)('has working Back and Sign Out without generation in %s', async language => {
  const actions = await open(initial, language); const text = storyGenerationCopy[language]; await tap(text.back); await tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1); expect(actions.onGenerate).not.toHaveBeenCalled();
});

it('does not claim a saved draft when no draft response exists', async () => {
  await open({ ...initial, notice: 'saved' }); expect(screen.queryByText(storyGenerationCopy.en.saved)).toBeNull();
});
