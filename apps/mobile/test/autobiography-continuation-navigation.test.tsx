import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import { StoriesHome } from '../src/stories/StoriesHome';
import { StoryDashboard } from '../src/stories/StoryDashboard';
import { StoryDetails } from '../src/stories/StoryDetails';
import { GenerateStory } from '../src/generation/GenerateStory';
import { Conversation } from '../src/stories/Conversation';
import { MemoryReview } from '../src/memories/MemoryReview';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { readMobileApiConfig } from '../src/api/config';
import { continueStoryProject, listStorySessions, StoryProjectsError,
  type ConversationSession, type StoryContinuation, type StoryProject } from '../src/api/story-projects';
import { generateStoryDraft } from '../src/api/story-drafts';
import { usePdfPrivacy, type PdfPrivacyValue } from '../src/exports/PdfPrivacy';
import { conversationCopy } from '../src/conversation-copy';
import type { Language } from '../src/i18n';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'),
  listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/api/story-drafts', () => ({ ...jest.requireActual('../src/api/story-drafts'), generateStoryDraft: jest.fn() }));
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: jest.fn() }));
jest.mock('../src/generation/GenerateStory', () => ({ GenerateStory: jest.fn(() => null) }));
jest.mock('../src/stories/StoryDashboard', () => ({ StoryDashboard: jest.fn(() => null) }));
jest.mock('../src/stories/StoryDetails', () => ({ StoryDetails: jest.fn(() => null) }));
jest.mock('../src/stories/CreateStory', () => ({ CreateStory: jest.fn(() => null) }));
jest.mock('../src/memories/MemoryReview', () => ({ MemoryReview: jest.fn(() => null) }));
jest.mock('../src/audio/SessionRecording', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { SessionRecording: React.forwardRef(function Recording(_props: unknown, ref) {
    React.useImperativeHandle(ref, () => ({ requestLeave: mockRequestLeave }));
    return null;
  }) };
});

const mockRequestLeave = jest.fn<void, [() => void]>();
const ownerA = '36000000-0000-4000-8000-000000000001', ownerB = '36000000-0000-4000-8000-000000000002';
const projectId = '37000000-0000-4000-8000-000000000001';
const draftId = '38000000-0000-4000-8000-000000000001';
const latestDraftId = '38000000-0000-4000-8000-000000000002';
const sessionId = '39000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T10:00:00Z';
const project = (language: Language = 'en'): StoryProject => ({ id: projectId, title: 'A fictional saved story',
  description: null, language, status: 'draft', created_at: stamp, updated_at: stamp });
const session = (language: Language = 'en'): ConversationSession => ({ id: sessionId, project_id: projectId,
  language, status: 'active', created_at: stamp, updated_at: stamp, ended_at: null });
const continuation = (language: Language = 'en'): StoryContinuation => ({ project_id: projectId, language,
  session: session(language), session_created: false, generation_triggered: false,
  latest_draft: { draft_id: latestDraftId, project_id: projectId, language, status: 'ready_for_review',
    version: 2, revision: 1, created_at: stamp, updated_at: stamp } });
const token = jest.fn(async (_owner: string) => 'synthetic-development-user-token');
const signOut = jest.fn();
const focusCleanups = new Set<() => void>();
function useMockFocus(callback: () => void | (() => void)) {
  useEffect(() => {
    const close = callback(); if (close) focusCleanups.add(close);
    return () => { if (close) { focusCleanups.delete(close); close(); } };
  }, [callback]);
}
function props(language: Language = 'en', owner = ownerA) {
  return { language, user: { id: owner, email: 'fictional@example.test' }, getAccessToken: token, onSignOut: signOut };
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
async function openSaved(language: Language = 'en') {
  const view = render(<StoriesHome {...props(language)} />); await settle();
  act(() => screen.UNSAFE_getByType(StoryDashboard).props.onOpenStory(projectId));
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project(language)));
  return view;
}
beforeEach(() => {
  focusCleanups.clear(); token.mockClear(); signOut.mockClear();
  mockRequestLeave.mockReset().mockImplementation(proceed => proceed());
  jest.mocked(useFocusEffect).mockImplementation(useMockFocus);
  jest.mocked(usePdfPrivacy).mockReturnValue({ consumeReturn: jest.fn(() => null) } as unknown as PdfPrivacyValue);
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: 'http://192.168.20.30:8000' });
  jest.mocked(listStorySessions).mockReset().mockResolvedValue([session()]);
  jest.mocked(continueStoryProject).mockReset().mockResolvedValue(continuation());
  jest.mocked(generateStoryDraft).mockClear(); jest.mocked(GenerateStory).mockClear();
  jest.mocked(MemoryReview).mockClear();
});

it.each<Language>(['en', 'sv'])('continues intentionally in %s and returns to the exact selected saved generation', async language => {
  jest.mocked(listStorySessions).mockResolvedValue([session(language)]);
  await openSaved(language);
  expect(listStorySessions).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  const saved = screen.UNSAFE_getByType(GenerateStory).props;
  act(() => { saved.onContinueStory(draftId); saved.onContinueStory(draftId); });
  await screen.findByText(conversationCopy[language].resumed);
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).not.toHaveBeenCalled();
  await jest.mocked(listStorySessions).mock.calls[0][0].getAccessToken(); expect(token).toHaveBeenLastCalledWith(ownerA);
  expect(jest.mocked(listStorySessions).mock.calls[0][0].expectedLanguage).toBe(language);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy[language].returnAutobiography }));
  expect(mockRequestLeave).toHaveBeenCalledTimes(1);
  const returned = screen.UNSAFE_getByType(GenerateStory).props;
  expect(returned.initialDraftId).toBe(draftId); expect(returned.project.id).toBe(projectId);
  expect(returned).not.toHaveProperty('content'); expect(returned).not.toHaveProperty('draft');
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('does not replace the selected older draft with continuation latest-draft metadata', async () => {
  jest.mocked(listStorySessions).mockResolvedValue([]);
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.resumed);
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.returnAutobiography }));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).not.toBe(latestDraftId);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('saved-draft review returns to the exact %s generation without creating a conversation', async language => {
  jest.mocked(listStorySessions).mockResolvedValue([session(language)]);
  await openSaved(language);
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onReviewMemories(draftId));
  await waitFor(() => expect(screen.UNSAFE_getByType(MemoryReview)).toBeDefined());
  const review = screen.UNSAFE_getByType(MemoryReview).props;
  expect(review).toMatchObject({ ownerId: ownerA, projectId, sessionId, sessionLanguage: language,
    backLabel: conversationCopy[language].returnAutobiography });
  act(() => review.onBack());
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  expect(continueStoryProject).not.toHaveBeenCalled(); expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('review within continuation returns to conversation before returning to the selected autobiography', async () => {
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.resumed);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.review }));
  act(() => screen.UNSAFE_getByType(MemoryReview).props.onBack());
  await screen.findByText(conversationCopy.en.resumed);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.returnAutobiography }));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  expect(listStorySessions).toHaveBeenCalledTimes(1); expect(continueStoryProject).not.toHaveBeenCalled();
});

it.each(['back', 'review', 'signOut'] as const)('preserves the existing recording/upload leave guard on %s', async destination => {
  let proceed: (() => void) | undefined;
  mockRequestLeave.mockImplementation(callback => { proceed = callback; });
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.resumed);
  const label = destination === 'back' ? conversationCopy.en.returnAutobiography : conversationCopy.en[destination];
  fireEvent.press(screen.getByRole('button', { name: label }));
  expect(mockRequestLeave).toHaveBeenCalledTimes(1); expect(screen.UNSAFE_getByType(Conversation)).toBeDefined();
  expect(screen.UNSAFE_queryByType(GenerateStory)).toBeNull(); expect(MemoryReview).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  act(() => proceed?.());
  if (destination === 'back') expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  else if (destination === 'review') expect(screen.UNSAFE_getByType(MemoryReview).props.sessionId).toBe(sessionId);
  else expect(signOut).toHaveBeenCalledTimes(1);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('clears the owner-scoped selection and ignores a late continuation result after changing account', async () => {
  jest.mocked(listStorySessions).mockResolvedValue([]); const pending = deferred<StoryContinuation>();
  jest.mocked(continueStoryProject).mockReturnValueOnce(pending.promise);
  const view = await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await waitFor(() => expect(continueStoryProject).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(continueStoryProject).mock.calls[0][0].signal!;
  view.rerender(<StoriesHome {...props('sv', ownerB)} />); await settle(); expect(signal.aborted).toBe(true);
  expect(screen.UNSAFE_getByType(StoryDashboard).props.user.id).toBe(ownerB);
  await act(async () => pending.resolve(continuation()));
  expect(screen.UNSAFE_queryByType(Conversation)).toBeNull(); expect(screen.UNSAFE_queryByType(GenerateStory)).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('drops the RAM-only continuation return identity when the authenticated route loses focus', async () => {
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.resumed);
  act(() => { for (const close of [...focusCleanups]) close(); });
  expect(screen.UNSAFE_queryByType(Conversation)).toBeNull(); expect(screen.UNSAFE_queryByType(GenerateStory)).toBeNull();
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('uses the canonical continuation RPC when an incomplete first page contains only completed sessions', async () => {
  jest.mocked(listStorySessions).mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({ ...session(),
    id: `49000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    status: 'completed' as const, ended_at: stamp })));
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.resumed);
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
  expect(screen.UNSAFE_getByType(ConversationScreen).props.state.session.id).toBe(sessionId);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('reconciles an uncertain continuation before an explicit retry and does not create a duplicate session', async () => {
  jest.mocked(listStorySessions).mockResolvedValueOnce([]);
  jest.mocked(continueStoryProject).mockRejectedValueOnce(new StoryProjectsError('timeout', undefined, true));
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onContinueStory(draftId));
  await screen.findByText(conversationCopy.en.uncertain);
  expect(continueStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.check }));
  await screen.findByText(conversationCopy.en.resumed);
  expect(listStorySessions).toHaveBeenCalledTimes(2); expect(continueStoryProject).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.returnAutobiography }));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('keeps the old details return path when review began before any saved draft existed', async () => {
  await openSaved(); act(() => screen.UNSAFE_getByType(GenerateStory).props.onReviewMemories());
  await waitFor(() => expect(screen.UNSAFE_getByType(MemoryReview)).toBeDefined());
  act(() => screen.UNSAFE_getByType(MemoryReview).props.onBack());
  expect(screen.UNSAFE_getByType(StoryDetails).props.projectId).toBe(projectId);
  expect(screen.UNSAFE_queryByType(GenerateStory)).toBeNull(); expect(continueStoryProject).not.toHaveBeenCalled();
});

it.each<Language>(['en', 'sv'])('preserves a selected older %s generation through story details and the dashboard', async language => {
  await openSaved(language);
  const saved = screen.UNSAFE_getByType(GenerateStory).props;
  act(() => saved.onSelectionChange(draftId));
  act(() => saved.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project(language)));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onBack());
  expect(screen.UNSAFE_getByType(StoryDashboard)).toBeDefined();
  act(() => screen.UNSAFE_getByType(StoryDashboard).props.onOpenStory(projectId));
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project(language)));
  const reopened = screen.UNSAFE_getByType(GenerateStory).props;
  expect(reopened.initialDraftId).toBe(draftId); expect(reopened).not.toHaveProperty('content');
  expect(reopened).not.toHaveProperty('draft'); expect(reopened).not.toHaveProperty('verification');
  expect(generateStoryDraft).not.toHaveBeenCalled(); expect(continueStoryProject).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('keeps selected generation identities separate for different projects', async () => {
  const otherProjectId = '37000000-0000-4000-8000-000000000002';
  const other = { ...project(), id: otherProjectId };
  await openSaved();
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onSelectionChange(draftId));
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDashboard).props.onOpenStory(otherProjectId));
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(other));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBeUndefined();
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onSelectionChange(latestDraftId));
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDashboard).props.onOpenStory(projectId));
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project()));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
});

it('clears per-project selected-generation hints when the verified account changes', async () => {
  const view = await openSaved();
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onSelectionChange(draftId));
  view.rerender(<StoriesHome {...props('en', ownerB)} />); await settle();
  act(() => screen.UNSAFE_getByType(StoryDashboard).props.onOpenStory(projectId));
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project()));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBeUndefined();
  expect(screen.UNSAFE_getByType(GenerateStory).props.user.id).toBe(ownerB);
  expect(generateStoryDraft).not.toHaveBeenCalled();
});

it('ignores malformed identities and stale selection callbacks from a previous saved-draft visit', async () => {
  await openSaved(); const previous = screen.UNSAFE_getByType(GenerateStory).props;
  act(() => previous.onSelectionChange(draftId));
  act(() => previous.onSelectionChange('not-a-draft-id'));
  act(() => previous.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project()));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  act(() => previous.onSelectionChange(latestDraftId));
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project()));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(draftId);
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onSelectionChange(latestDraftId));
  act(() => screen.UNSAFE_getByType(GenerateStory).props.onBack());
  act(() => screen.UNSAFE_getByType(StoryDetails).props.onGenerate(project()));
  expect(screen.UNSAFE_getByType(GenerateStory).props.initialDraftId).toBe(latestDraftId);
});
