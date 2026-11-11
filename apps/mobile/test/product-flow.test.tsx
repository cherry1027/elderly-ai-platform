import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeRef, nativeText } from './native-tree';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, Dimensions, StyleSheet, type AppStateStatus } from 'react-native';
import * as api from '../src/real-ai/api';
import * as projects from '../src/api/story-projects';
import { createNativeRecorder, createRecordingId } from '../src/audio/native-recorder';
import { RealStoryWorkspace } from '../src/real-ai/RealStoryWorkspace';
import { storyContentCopy } from '../src/real-ai/StoryContent';
import { Screen } from '../src/components/Screen';
import { getComponent } from './component-probe';
import { realCopy } from '../src/real-ai/copy';
import { conversationModeCopy } from '../src/real-ai/conversation-mode';
import { mediaPrivacy } from '../src/real-ai/media-privacy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { realDraft, realIds as ids, realMemory, realMessage, realTranscript } from './real-ai-fixtures';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});
jest.mock('../src/real-ai/api', () => ({ ...jest.requireActual('../src/real-ai/api'),
  getRealCapabilities: jest.fn(), getRealTranscripts: jest.fn(), getRealMessages: jest.fn(), getRealMemories: jest.fn(), getRealDrafts: jest.fn(),
  getRealDraftHistory: jest.fn(), getRealExports: jest.fn(), hashRealText: jest.fn(), sendRealTextMessage: jest.fn(), reviewRealMemory: jest.fn(),
  getRealOperation: jest.fn(), findRealOperation: jest.fn(), transcribeRealRecording: jest.fn(), sendRealMessage: jest.fn(),
  generateRealDraft: jest.fn(), editRealDraft: jest.fn(), exportRealDraft: jest.fn(), downloadRealExport: jest.fn(), createRealSpeech: jest.fn(),
}));
jest.mock('../src/real-ai/conversation-mode', () => ({ ...jest.requireActual('../src/real-ai/conversation-mode'), readConversationMode: async () => null, saveConversationMode: jest.fn() }));
jest.mock('../src/api/story-projects', () => ({ ...jest.requireActual('../src/api/story-projects'), listStorySessions: jest.fn(), continueStoryProject: jest.fn() }));
jest.mock('../src/audio/native-recorder', () => ({ ...jest.requireActual('../src/audio/native-recorder'), createNativeRecorder: jest.fn(), createRecordingId: jest.fn() }));
const mockPrivacy = { ready: true, failed: false, release: jest.fn(), rememberReturn: jest.fn(), createStore: jest.fn() };
jest.mock('../src/exports/PdfPrivacy', () => ({ usePdfPrivacy: () => mockPrivacy }));
const mockPlayback = { play: jest.fn(), stop: jest.fn(), dispose: jest.fn(async () => {}) };
jest.mock('../src/real-ai/native-playback', () => ({ createRealPlayback: () => mockPlayback }));

const renderedReview: object[] = [];
// Optional offline evidence records the actual reconciled host tree, not native pixels.
function captureRenderedReview(name: string) {
  if (process.env.MEMY_RENDER_REVIEW !== '1') return;
  const controls = (['button', 'tab', 'header', 'checkbox', 'alert'] as const).flatMap(role => screen.queryAllByRole(role).map(node => ({
    role, label: node.props.accessibilityLabel ?? nativeText(node), state: node.props.accessibilityState,
    language: node.props.accessibilityLanguage, style: StyleSheet.flatten(node.props.style),
  })));
  renderedReview.push({ name, kind: 'actual React Native test-rendered host tree; no native pixel/layout claim', controls,
    visibleText: screen.queryAllByText(/\S/).map(node => ({ text: nativeText(node), style: StyleSheet.flatten(node.props.style) })),
    input: screen.queryByTestId('conversation-input') ? {
      style: StyleSheet.flatten(screen.getByTestId('conversation-input').props.style),
      multiline: screen.getByTestId('conversation-input').props.multiline,
      allowFontScaling: screen.getByTestId('conversation-input').props.allowFontScaling,
    } : null });
}
afterAll(() => {
  if (process.env.MEMY_RENDER_REVIEW === '1') writeFileSync(resolve(process.cwd(), '../../outputs/final-ui-refinement/rendered-workspace-review.json'), JSON.stringify(renderedReview, null, 2));
});

const t = realCopy.en;
const project = { id: ids.project, language: 'en' as const, title: 'Synthetic product-flow story', description: null, status: 'draft',
  created_at: '2026-11-04T12:00:00Z', updated_at: '2026-11-04T12:00:00Z' };
const user = { id: '80000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' };
const props = { language: 'en' as const, user, project, config: { baseUrl: 'http://192.168.20.40:8000', apiContract: 'real-v2' as const },
  getAccessToken: jest.fn(async () => 'synthetic.token.signature'), onBack: jest.fn(), onSignOut: jest.fn() };
const caps = { contract: 'real-v2' as const, mode: 'real' as const, enabled: true, transcription: true, conversation: true, writing: true, speech: true, reason: 'READY' };
const session = { id: ids.session, project_id: ids.project, language: 'en' as const, status: 'active' as const,
  created_at: project.created_at, updated_at: project.updated_at, ended_at: null };
const clip = { uri: 'file:///synthetic-private-cache/product.m4a', name: 'recording.m4a' as const, type: 'audio/mp4' as const, size: 1000, durationMs: 2000 };
const recorder = { requestPermission: jest.fn(async () => true), start: jest.fn(async () => {}), stop: jest.fn(async () => clip),
  getStatus: jest.fn(() => ({ durationMs: 1000, isRecording: true, interrupted: false })), discard: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
let listeners: ((state: AppStateStatus) => void)[] = [];
async function press(label: string) { await fireEvent.press(screen.getByRole('button', { name: label })); await act(async () => {}); }
async function tab(label: string) { await fireEvent.press(screen.getByRole('tab', { name: label })); await act(async () => {}); }
async function opened(language: 'en' | 'sv' = 'en') {
  const view = await render(<RealStoryWorkspace {...props} language={language} />);
  await waitFor(() => expect(screen.getByLabelText(realCopy[language].input)).toBeEnabled());
  return view;
}
function noPaidActions() {
  expect(api.sendRealTextMessage).not.toHaveBeenCalled(); expect(api.sendRealMessage).not.toHaveBeenCalled();
  expect(api.transcribeRealRecording).not.toHaveBeenCalled(); expect(api.generateRealDraft).not.toHaveBeenCalled();
  expect(api.createRealSpeech).not.toHaveBeenCalled();
}
beforeEach(() => {
  AppState.currentState = 'active'; listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: () => { listeners = listeners.filter(item => item !== callback); } }; });
  jest.mocked(api.getRealCapabilities).mockReset().mockResolvedValue(caps);
  jest.mocked(projects.listStorySessions).mockReset().mockResolvedValue([session]);
  jest.mocked(projects.continueStoryProject).mockReset();
  jest.mocked(api.getRealTranscripts).mockReset().mockResolvedValue([]); jest.mocked(api.getRealMessages).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealMemories).mockReset().mockResolvedValue([]); jest.mocked(api.getRealDrafts).mockReset().mockResolvedValue([]);
  jest.mocked(api.getRealDraftHistory).mockReset().mockResolvedValue([]); jest.mocked(api.getRealExports).mockReset().mockResolvedValue([]);
  jest.mocked(api.hashRealText).mockReset().mockResolvedValue('a'.repeat(64)); jest.mocked(createRecordingId).mockReturnValue(ids.key);
  jest.mocked(api.sendRealTextMessage).mockReset().mockImplementation(async (_scope, original) => ({
    user_message: realMessage('user', { text: original, source_transcript_id: null, source_text_input_id: ids.key,
      provenance: { mode: 'original', provider: 'user', model: null, version: 1 } }),
    message: realMessage('assistant', { text: 'What do you remember about the garden?', source_transcript_id: null, source_text_input_id: ids.key }),
    memories: [realMemory()], mode: 'real',
  }));
  jest.mocked(api.generateRealDraft).mockReset().mockResolvedValue(realDraft());
  jest.mocked(createNativeRecorder).mockReturnValue(recorder);
  jest.mocked(api.transcribeRealRecording).mockReset().mockResolvedValue(realTranscript());
  jest.mocked(api.sendRealMessage).mockReset().mockResolvedValue({ user_message: realMessage(), message: realMessage('assistant'), memories: [realMemory()], mode: 'real' });
});
afterEach(async () => { await mediaPrivacy.retry(); jest.restoreAllMocks(); AppState.currentState = 'active'; expect(globalThis.fetch).not.toHaveBeenCalled(); });

describe('Talk → Memories → My Story product flow — synthetic services only', () => {
  it.each(['en', 'sv'] as const)('opens Talk with all three concepts reachable and exactly four startup reads in %s', async language => {
    const copy = realCopy[language]; await opened(language);
    expect(screen.getByRole('tab', { name: copy.chat }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('tab', { name: copy.memories })).toBeEnabled(); expect(screen.getByRole('tab', { name: copy.book })).toBeEnabled();
    expect(api.getRealCapabilities).toHaveBeenCalledTimes(1); expect(projects.listStorySessions).toHaveBeenCalledTimes(1);
    expect(api.getRealMessages).toHaveBeenCalledTimes(1); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
    expect(api.getRealMemories).not.toHaveBeenCalled(); expect(api.getRealDrafts).not.toHaveBeenCalled();
    expect(projects.continueStoryProject).not.toHaveBeenCalled(); noPaidActions();
  });
  it.each(['en', 'sv'] as const)('Finish opens My Story and offers memory review without generating in %s', async language => {
    const copy = realCopy[language], story = storyContentCopy[language];
    jest.mocked(api.getRealMemories).mockResolvedValue([realMemory()]); await opened(language);
    await press(conversationModeCopy[language].finishAndOpenStory);
    expect(screen.getByRole('tab', { name: copy.book }).props.accessibilityState.selected).toBe(true);
    await waitFor(() => expect(screen.getByText(story.answerFirst)).toBeOnTheScreen());
    expect(api.getRealMemories).toHaveBeenCalledTimes(1); expect(api.getRealDrafts).toHaveBeenCalledTimes(1); noPaidActions();
    await press(story.reviewFirst);
    expect(screen.getByRole('tab', { name: copy.memories }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(realMemory().value)).toBeOnTheScreen();
    captureRenderedReview(`Memories after Finish / ${language}`);
    await tab(copy.chat);
    expect(api.getRealMessages).toHaveBeenCalledTimes(1); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1); noPaidActions();
  });
  it.each(['en', 'sv'] as const)('leaves Talk when no memories were saved and offers a concrete way back in %s', async language => {
    const copy = realCopy[language], story = storyContentCopy[language];
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('assistant')]);
    await opened(language);
    await press(conversationModeCopy[language].finishAndOpenStory);
    await waitFor(() => expect(screen.getByText(copy.emptyBook)).toBeOnTheScreen());
    expect(screen.queryByRole('button', { name: copy.generate })).toBeNull();
    await press(story.shareMemory);
    expect(screen.getByRole('tab', { name: copy.chat }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(realMessage('assistant').text)).toBeOnTheScreen();
    expect(api.getRealMessages).toHaveBeenCalledTimes(1); noPaidActions();
  });
  it('keeps a successful message and its follow-up in Talk without demanding review or generating a story', async () => {
    await opened(); await fireEvent.changeText(screen.getByLabelText(t.input), 'We lived near the garden.'); await press(t.send);
    await waitFor(() => expect(screen.getByText('What do you remember about the garden?')).toBeOnTheScreen());
    expect(screen.getByRole('tab', { name: t.chat }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(t.input)).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: t.reviewSuggested })).toBeEnabled();
    expect(screen.queryByRole('button', { name: t.generate })).toBeNull(); expect(api.generateRealDraft).not.toHaveBeenCalled();
    expect(api.getRealMemories).not.toHaveBeenCalled(); expect(api.getRealDrafts).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it('routes Finish with unsent words through the existing leave warning and keeps words when staying', async () => {
    await opened(); await fireEvent.changeText(screen.getByLabelText(t.input), 'My private unfinished thought.'); await press(conversationModeCopy.en.finishAndOpenStory);
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen(); expect(api.getRealMemories).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(screen.getByLabelText(t.input)).toHaveDisplayValue('My private unfinished thought.');
    expect(screen.getByRole('tab', { name: t.chat }).props.accessibilityState.selected).toBe(true); noPaidActions();
  });
  it('opens My Story at the top only after the guarded Finish transition is accepted', async () => {
    await opened(); const scrollTo = jest.spyOn(nativeRef(getComponent(Screen).props.scrollViewRef), 'scrollTo'); scrollTo.mockClear();
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Unfinished words before leaving.'); await press(conversationModeCopy.en.finishAndOpenStory);
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen(); expect(scrollTo).not.toHaveBeenCalled();
    await press(leaveCopy.en.discard);
    await waitFor(() => expect(screen.getByRole('tab', { name: t.book }).props.accessibilityState.selected).toBe(true));
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false }); noPaidActions();
  });
  it('routes Finish after an uncertain message through existing recovery without another send or fake success', async () => {
    jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await opened(); await fireEvent.changeText(screen.getByLabelText(t.input), 'A message with an uncertain result.'); await press(t.send);
    await waitFor(() => expect(screen.getByText(t.uncertain)).toBeOnTheScreen()); await press(conversationModeCopy.en.finishAndOpenStory);
    expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); expect(screen.getByRole('tab', { name: t.book }).props.accessibilityState.selected).toBe(false);
    expect(api.getRealMemories).not.toHaveBeenCalled(); await press(leaveCopy.en.keep);
    expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(api.generateRealDraft).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('keeps privacy information available behind the quiet menu in %s', async language => {
    const copy = realCopy[language]; await opened(language);
    expect(screen.queryByText(copy.textConsent)).toBeNull(); expect(screen.queryByText(copy.introduction)).toBeNull();
    await press(copy.moreActions); await press(copy.privacy);
    expect(screen.getByText(copy.textConsent)).toBeOnTheScreen(); expect(screen.getByText(copy.introduction)).toBeOnTheScreen();
    expect(screen.getByText(copy.voice)).toBeOnTheScreen(); expect(screen.getByRole('button', { name: copy.reload })).toBeOnTheScreen(); noPaidActions();
  });
  it('creates My Story only after the explicit consent and Create action', async () => {
    jest.mocked(api.getRealMemories).mockResolvedValue([realMemory({ status: 'confirmed', version: 2, clarification_question: null })]);
    await opened(); await tab(t.book); await waitFor(() => expect(screen.getByRole('button', { name: t.generate })).toBeOnTheScreen());
    expect(screen.getByRole('button', { name: t.generate })).toBeDisabled(); expect(api.generateRealDraft).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('checkbox', { name: t.generationConsent }));
    expect(api.generateRealDraft).not.toHaveBeenCalled(); await press(t.generate);
    await waitFor(() => expect(screen.getByText(realDraft().content)).toBeOnTheScreen()); expect(api.generateRealDraft).toHaveBeenCalledTimes(1);
    captureRenderedReview('My Story result');
    expect(api.sendRealTextMessage).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it.each([{ width: 320, fontScale: 1 }, { width: 390, fontScale: 2.5 }])('keeps the integrated composer and Back reachable at $width points / fontScale $fontScale', async dimensions => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ ...dimensions, height: 700, scale: 2 }); await opened();
    const composer = screen.getByTestId('conversation-composer');
    expect(within(composer).getByLabelText(t.input)).toBeOnTheScreen();
    const speak = within(composer).getByRole('button', { name: t.speakMode }), send = within(composer).getByRole('button', { name: t.send });
    expect(speak).toHaveStyle({ minHeight: 56 }); expect(send).toHaveStyle({ minHeight: 56, minWidth: 56 });
    expect(screen.getByTestId('conversation-composer-row')).toHaveStyle({ flexDirection: 'column' });
    expect(screen.getByLabelText(t.input).props.allowFontScaling).toBe(true); expect(screen.getByTestId('story-top-back')).toBeOnTheScreen();
    expect(within(screen.getByTestId('story-content-scroll')).queryByTestId('conversation-composer')).toBeNull(); noPaidActions();
  });
  it('uses the microphone action for consent and retains an explicit Stop during recording when speech is paused', async () => {
    jest.mocked(api.getRealCapabilities).mockResolvedValue({ ...caps, speech: false });
    await opened(); await press(t.speakMode); await press(t.start); expect(screen.getByText(t.consentTitle)).toBeOnTheScreen();
    expect(recorder.requestPermission).not.toHaveBeenCalled(); await press(t.consentContinue);
    await waitFor(() => expect(screen.getByRole('button', { name: t.stop })).toBeOnTheScreen());
    expect(recorder.start).toHaveBeenCalledTimes(1); expect(api.transcribeRealRecording).not.toHaveBeenCalled();
    captureRenderedReview('Recording with Stop');
    await press(t.stop); await waitFor(() => expect(api.sendRealMessage).toHaveBeenCalledTimes(1));
    expect(api.transcribeRealRecording).toHaveBeenCalledWith(expect.anything(), clip, true, expect.any(String));
    expect(screen.getByRole('tab', { name: t.chat }).props.accessibilityState.selected).toBe(true);
    expect(api.generateRealDraft).not.toHaveBeenCalled(); expect(api.createRealSpeech).not.toHaveBeenCalled();
  });
  it.each(['en', 'sv'] as const)('keeps one top Back and hides the unavailable banner completely when AI is available in %s', async language => {
    const copy = realCopy[language]; await opened(language);
    expect(screen.getByTestId('story-top-back')).toHaveStyle({ minHeight: 56 });
    expect(screen.getByTestId('story-top-back').props.accessibilityLabel).toBe(`${language === 'sv' ? 'Gå tillbaka' : 'Go back'}: ${copy.back}`);
    expect(screen.queryByRole('button', { name: copy.back })).toBeNull();
    expect(screen.queryByTestId('ai-availability-banner')).toBeNull(); expect(screen.queryByText(copy.disabled)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.details })).toBeNull();
    captureRenderedReview(`available Talk / ${language}`);
    await fireEvent.press(screen.getByTestId('story-top-back')); expect(props.onBack).toHaveBeenCalledTimes(1); noPaidActions();
  });
  it.each(['en', 'sv'] as const)('keeps exact original words secondary without another read or provider action in %s', async language => {
    const copy = realCopy[language], typed = '  My exact typed words.\n', spoken = 'My exact spoken words, including a hesitation.';
    jest.mocked(api.getRealMessages).mockResolvedValue([realMessage('user', { text: typed, source_transcript_id: null, source_text_input_id: ids.key })]);
    jest.mocked(api.getRealTranscripts).mockResolvedValue([realTranscript({ text: spoken })]);
    await opened(language);
    expect(screen.getByText(typed)).toBeOnTheScreen(); expect(screen.getByText(spoken)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.yourWords })).toBeNull();
    expect(screen.queryByText(copy.originalTyped)).toBeNull(); expect(screen.queryByText(copy.original)).toBeNull();
    await press(copy.moreActions); expect(screen.getByRole('button', { name: copy.yourWords })).toBeOnTheScreen();
    expect(screen.queryByText(copy.originalTyped)).toBeNull();
    await press(copy.yourWords);
    expect(screen.getByText(copy.originalTyped)).toBeOnTheScreen(); expect(screen.getByText(copy.original)).toBeOnTheScreen();
    expect(screen.getAllByText(typed)).toHaveLength(2); expect(screen.getAllByText(spoken)).toHaveLength(2);
    captureRenderedReview(`original words disclosed / ${language}`);
    expect(api.getRealCapabilities).toHaveBeenCalledTimes(1); expect(projects.listStorySessions).toHaveBeenCalledTimes(1);
    expect(api.getRealMessages).toHaveBeenCalledTimes(1); expect(api.getRealTranscripts).toHaveBeenCalledTimes(1);
    expect(api.getRealMemories).not.toHaveBeenCalled(); expect(api.getRealDrafts).not.toHaveBeenCalled(); noPaidActions();
  });
  it('keeps the empty composer compact while preserving multiline growth and control targets', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 }); await opened();
    const input = screen.getByTestId('conversation-input');
    expect(input).toHaveStyle({ minHeight: 56, maxHeight: 176, paddingVertical: 8 });
    expect(StyleSheet.flatten(input.props.style).height).toBeUndefined();
    expect(input.props.multiline).toBe(true); expect(input.props.allowFontScaling).toBe(true); expect(input.props.placeholder).toBe(t.input);
    expect(screen.getByTestId('conversation-composer-row')).toHaveStyle({ flexDirection: 'row' });
    expect(screen.getByRole('button', { name: t.speakMode })).toHaveStyle({ minHeight: 56 });
    expect(screen.getByRole('button', { name: t.send })).toHaveStyle({ minHeight: 56, minWidth: 56 });
    const words = 'A first memory.\nA second detail.\nSomething else I remembered.';
    await fireEvent.changeText(input, words); expect(input).toHaveDisplayValue(words);
    captureRenderedReview('compact multiline composer'); noPaidActions();
  });
  it.each(['en', 'sv'] as const)('keeps optional story details in the quiet menu and uses its existing safe callback in %s', async language => {
    const copy = realCopy[language], onStoryDetails = jest.fn();
    await render(<RealStoryWorkspace {...props} language={language} onStoryDetails={onStoryDetails} />);
    await waitFor(() => expect(screen.getByLabelText(copy.input)).toBeEnabled());
    expect(screen.queryByRole('button', { name: copy.storyDetails })).toBeNull();
    await press(copy.moreActions); await press(copy.storyDetails);
    expect(onStoryDetails).toHaveBeenCalledTimes(1); expect(props.onBack).not.toHaveBeenCalled(); noPaidActions();
  });
  it('guards optional story details when there are unsent words', async () => {
    const onStoryDetails = jest.fn(); await render(<RealStoryWorkspace {...props} onStoryDetails={onStoryDetails} />);
    await waitFor(() => expect(screen.getByLabelText(t.input)).toBeEnabled());
    await fireEvent.changeText(screen.getByLabelText(t.input), 'Unsent private words.'); await press(t.moreActions); await press(t.storyDetails);
    expect(screen.getByText(leaveCopy.en.dirty)).toBeOnTheScreen(); expect(onStoryDetails).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(screen.getByLabelText(t.input)).toHaveDisplayValue('Unsent private words.');
    await press(t.storyDetails); await press(leaveCopy.en.discard); expect(onStoryDetails).toHaveBeenCalledTimes(1); noPaidActions();
  });
  it('guards optional story details after an uncertain send without repeating the request', async () => {
    const onStoryDetails = jest.fn(); jest.mocked(api.sendRealTextMessage).mockRejectedValueOnce(new api.RealAiError('network', undefined, true));
    await render(<RealStoryWorkspace {...props} onStoryDetails={onStoryDetails} />);
    await waitFor(() => expect(screen.getByLabelText(t.input)).toBeEnabled());
    await fireEvent.changeText(screen.getByLabelText(t.input), 'A message with an uncertain result.'); await press(t.send);
    await waitFor(() => expect(screen.getByText(t.uncertain)).toBeOnTheScreen()); await press(t.moreActions); await press(t.storyDetails);
    expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen(); expect(onStoryDetails).not.toHaveBeenCalled();
    await press(leaveCopy.en.keep); expect(api.sendRealTextMessage).toHaveBeenCalledTimes(1); expect(api.generateRealDraft).not.toHaveBeenCalled();
  });
  it('does not invent a story-details action for standalone consumers without the callback', async () => {
    await opened(); await press(t.moreActions); expect(screen.queryByRole('button', { name: t.storyDetails })).toBeNull(); noPaidActions();
  });

});
