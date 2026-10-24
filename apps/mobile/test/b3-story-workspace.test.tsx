import { requireCallback } from './root-shell-helpers';
import { getComponent } from './component-probe';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { StoryDetails } from '../src/stories/StoryDetails';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { StoryDisclosure } from '../src/components/StoryPresentation';
import { Conversation } from '../src/stories/Conversation';
import { MemoryReview } from '../src/memories/MemoryReview';
import { readMobileApiConfig } from '../src/api/config';
import { getStoryProject, updateStoryProject, listStorySessions, continueStoryProject,
  type ConversationSession, type StoryProject } from '../src/api/story-projects';
import { generateStoryDraft } from '../src/api/story-drafts';
import { storyDetailsCopy } from '../src/story-details-copy';
import { conversationCopy } from '../src/conversation-copy';
import type { Language } from '../src/i18n';

jest.mock('../src/screens/StoryDetailsScreen', () => { const actual = jest.requireActual<typeof import('../src/screens/StoryDetailsScreen')>('../src/screens/StoryDetailsScreen'); return { ...actual, StoryDetailsScreen: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(actual.StoryDetailsScreen) }; });
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  getStoryProject: jest.fn(), updateStoryProject: jest.fn(), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'), generateStoryDraft: jest.fn() }));
jest.mock('../src/audio/SessionRecording', () => ({ SessionRecording: () => null }));
jest.mock('../src/memories/MemoryReview', () => ({ MemoryReview: jest.requireActual<typeof import('./component-probe')>('./component-probe').observeComponent(jest.fn(() => null)) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const owner = { id: 'fictional-account-a', email: 'fictional@example.test' };
const token = jest.fn(async (_owner: string) => 'synthetic-user-access-token');
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title: language === 'sv' ? 'En påhittad sommar' : 'A fictional summer',
  language, description: 'Fictional project description', status: 'draft', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
const session = (language: Language, status: ConversationSession['status']): ConversationSession => ({ id: sessionId,
  project_id: projectId, language, status, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ended_at: status === 'active' ? null : '2026-01-02T00:00:00Z' });
beforeEach(() => {
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(getStoryProject).mockImplementation(async () => project());
  jest.mocked(listStorySessions).mockResolvedValue([]);
});
const callbacks = () => ({ onEdit: jest.fn(), onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn(),
  onConversation: jest.fn(), onReviewMemories: jest.fn(), onGenerate: jest.fn() });

it.each<Language>(['en', 'sv'])('presents clear %s workspace actions without exposing secondary details initially', async language => {
  const actions = callbacks(), text = storyDetailsCopy[language], saved = project(language);
  await render(<StoryDetailsScreen language={language} state={{ status: 'ready', project: saved }} {...actions} />);
  expect(screen.getByRole('header', { name: saved.title })).toBeOnTheScreen();
  expect(screen.getByText(`${text.language}: ${language === 'sv' ? text.swedish : text.english}`)).toBeOnTheScreen();
  expect(screen.getByText(text.autobiographyHelp)).toBeOnTheScreen();
  expect(screen.queryByText(saved.description!)).toBeNull();
  expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.queryByRole('button', { name: text.refresh })).toBeNull();
  for (const [label, callback] of [[text.conversation, actions.onConversation], [text.review, actions.onReviewMemories],
    [text.generate, actions.onGenerate]] as const) {
    expect(callback).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: label }); expect(button).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(button); expect(callback).toHaveBeenCalledTimes(1);
  }
  const more = screen.getByRole('button', { name: text.more }); expect(more.props.accessibilityState.expanded).toBe(false);
  expect(more).toHaveStyle({ minHeight: 56 }); await fireEvent(more, 'focus'); expect(more).toHaveStyle({ borderColor: '#342f27' });
  await fireEvent.press(more); expect(more.props.accessibilityState.expanded).toBe(true);
  expect(screen.getByText(saved.description!)).toHaveProp('selectable', true);
  expect(screen.getByText(text.metadataHelp)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: text.edit })); expect(actions.onEdit).toHaveBeenCalledTimes(1);
  await fireEvent.press(more); expect(screen.queryByRole('button', { name: text.edit })).toBeNull();
  expect(screen.getByRole('button', { name: text.back })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: text.signOut })).toBeOnTheScreen();
  for (const node of screen.getAllByText(/[\s\S]*/, { includeHiddenElements: true })) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('opening the %s owned workspace only reads project metadata', async language => {
  const actions = { onBack: jest.fn(), onSignOut: jest.fn(), onConversation: jest.fn(), onReviewMemories: jest.fn(), onGenerate: jest.fn() };
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  await render(<StoryDetails language={language} user={owner} projectId={projectId} getAccessToken={token} {...actions} />);
  await screen.findByRole('button', { name: storyDetailsCopy[language].review });
  expect(getStoryProject).toHaveBeenCalledTimes(1); await jest.mocked(getStoryProject).mock.calls[0][0].getAccessToken();
  expect(token).toHaveBeenLastCalledWith(owner.id);
  expect(listStorySessions).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(updateStoryProject).not.toHaveBeenCalled();
  expect(actions.onConversation).not.toHaveBeenCalled(); expect(actions.onGenerate).not.toHaveBeenCalled();
  const review = requireCallback(getComponent(StoryDetailsScreen).props.onReviewMemories);
  await act(() => { review(); review(); }); expect(actions.onReviewMemories).toHaveBeenCalledTimes(1);
  expect(actions.onReviewMemories).toHaveBeenCalledWith(project(language));
});

function ReviewHarness({ language }: { language: Language }) {
  const [selected, setSelected] = useState<StoryProject | null>(null);
  return selected ? <Conversation language={language} user={owner} project={selected} getAccessToken={token}
    reviewOnOpen onBack={() => setSelected(null)} onSignOut={jest.fn()} />
    : <StoryDetails language={language} user={owner} projectId={projectId} getAccessToken={token}
      onBack={jest.fn()} onSignOut={jest.fn()} onReviewMemories={setSelected} />;
}
it.each<Language>(['en', 'sv'])('routes %s review through saved active or completed sessions without a continuation POST', async language => {
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  jest.mocked(listStorySessions).mockResolvedValue([session(language, 'completed')]);
  await render(<ReviewHarness language={language} />);
  await fireEvent.press(await screen.findByRole('button', { name: storyDetailsCopy[language].review }));
  await waitFor(() => expect(MemoryReview).toHaveBeenCalled());
  const review = getComponent(MemoryReview).props;
  expect(review).toMatchObject({ ownerId: owner.id, projectId, sessionId, sessionLanguage: language });
  const request = jest.mocked(listStorySessions).mock.calls[0][0];
  expect(request).toMatchObject({ projectId, expectedLanguage: language });
  await request.getAccessToken(); expect(token).toHaveBeenLastCalledWith(owner.id);
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
  await act(() => review.onBack()); await screen.findByRole('button', { name: storyDetailsCopy[language].review });
  expect(getStoryProject).toHaveBeenCalledTimes(2); expect(continueStoryProject).not.toHaveBeenCalled();
});
it.each<Language>(['en', 'sv'])('shows honest %s review failure when no session exists and never creates one', async language => {
  jest.mocked(getStoryProject).mockResolvedValue(project(language));
  await render(<ReviewHarness language={language} />);
  await fireEvent.press(await screen.findByRole('button', { name: storyDetailsCopy[language].review }));
  await screen.findByText(conversationCopy[language].errors['not-found']);
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(MemoryReview).not.toHaveBeenCalled();
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('keeps an old account’s captured workspace action inert after owner change', async () => {
  const review = jest.fn(), props = { language: 'en' as const, user: owner, projectId, getAccessToken: token,
    onBack: jest.fn(), onSignOut: jest.fn(), onReviewMemories: review };
  const view = await render(<StoryDetails {...props} />); await screen.findByRole('button', { name: storyDetailsCopy.en.review });
  const old = requireCallback(getComponent(StoryDetailsScreen).props.onReviewMemories);
  await view.rerender(<StoryDetails {...props} user={{ id: 'fictional-account-b', email: 'other@example.test' }} />);
  await screen.findByRole('button', { name: storyDetailsCopy.en.review }); await act(() => old());
  expect(review).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
});

it('collapses disclosure without remounting or clearing its mounted controller boundary', async () => {
  const mounted = jest.fn(), unmounted = jest.fn();
  function Child() { useEffect(() => { mounted(); return unmounted; }, []); return <Text allowFontScaling>Saved source evidence</Text>; }
  const view = await render(<StoryDisclosure language="en" label="Source evidence"><Child /></StoryDisclosure>);
  const disclosure = screen.getByRole('button', { name: 'Source evidence' });
  expect(mounted).toHaveBeenCalledTimes(1); expect(screen.queryByText('Saved source evidence')).toBeNull();
  await fireEvent.press(disclosure); expect(screen.getByText('Saved source evidence')).toBeOnTheScreen();
  await fireEvent.press(disclosure); expect(screen.queryByText('Saved source evidence')).toBeNull();
  expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled();
  await view.unmount(); expect(unmounted).toHaveBeenCalledTimes(1);
});
