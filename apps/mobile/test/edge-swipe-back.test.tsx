import { nativeNodes } from './native-tree';
import { getComponent } from './component-probe';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Keyboard, Platform, Text, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Screen } from '../src/components/Screen';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { EditStoryScreen } from '../src/screens/EditStoryScreen';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { storyDetailsCopy } from '../src/story-details-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { completeEdgeSwipe, startEdgeSwipe } from './edge-swipe-events';

const noop = () => {};
const project = { id: '11111111-1111-4111-8111-111111111111', title: 'A saved story', language: 'en' as const,
  description: null, status: 'draft', created_at: '2026-11-02T12:00:00Z', updated_at: '2026-11-02T12:00:00Z' };
const surface = () => screen.getByTestId('story-gesture-surface');
async function open(onPress = jest.fn()) {
  await render(<Screen back={{ language: 'en', label: 'Back to Story', onPress }}><Text>A saved story</Text></Screen>);
  return onPress;
}
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios'); AppState.currentState = 'active';
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); AppState.currentState = 'active'; expect(globalThis.fetch).not.toHaveBeenCalled(); });

it('completes a left-edge swipe once through the same action as the visible Back button', async () => {
  const back = await open();
  await completeEdgeSwipe(surface()); expect(back).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(back).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('story-top-back')).toHaveStyle({ minHeight: 56 });
});
it.each([12, 45, 70])('cancels a short drag ending at x=%s, without dismissing the keyboard', async endX => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss'), back = await open();
  const swipe = await startEdgeSwipe(surface()); await swipe.move(endX); await swipe.release();
  expect(back).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
});
it('cancels a completed-distance drag returned below threshold before release', async () => {
  const back = await open(), swipe = await startEdgeSwipe(surface());
  await swipe.move(32); await swipe.move(200); await swipe.move(45); await swipe.release(); expect(back).not.toHaveBeenCalled();
});
it.each([16, 40, 180, 300])('does not capture horizontal motion starting within the content at x=%s', async startX => {
  const back = await open(), swipe = await startEdgeSwipe(surface(), startX);
  expect(await swipe.move(startX + 200)).toBe(false); await swipe.release(); expect(back).not.toHaveBeenCalled();
});
it('leaves vertical scrolling alone, including a later horizontal turn', async () => {
  const back = await open(), swipe = await startEdgeSwipe(surface());
  expect(await swipe.move(10, 250)).toBe(false);
  expect(await swipe.move(200, 250)).toBe(false); await swipe.release();
  await fireEvent.scroll(screen.getByTestId('story-content-scroll'), { nativeEvent: { contentOffset: { y: 1000 } } });
  expect(back).not.toHaveBeenCalled();
});
it.each(['vertical turn', 'termination', 'multitouch', 'responder takeover'] as const)('cancels after capture on %s', async kind => {
  const back = await open(), swipe = await startEdgeSwipe(surface()); await swipe.move(32);
  if (kind === 'vertical turn') await swipe.move(50, 280);
  if (kind === 'termination') await swipe.terminate();
  if (kind === 'multitouch') { await swipe.touches(2); await swipe.touches(1); }
  if (kind === 'responder takeover') await act(() => { expect(surface().props.onResponderTerminationRequest(swipe.releaseEvent(200))).toBe(true); });
  await swipe.release(200, 200); expect(back).not.toHaveBeenCalled();
});
it('cancels across background/foreground and does not replay a stale release', async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { listeners.push(callback); return { remove: jest.fn() }; });
  const back = await open(), swipe = await startEdgeSwipe(surface()); await swipe.move(32);
  await act(() => { for (const state of ['background', 'active'] as const) { AppState.currentState = state; listeners.forEach(callback => callback(state)); } });
  await swipe.release(200); expect(back).not.toHaveBeenCalled();
  await completeEdgeSwipe(surface()); expect(back).toHaveBeenCalledTimes(1);
});
it('ignores a release delivered after the screen unmounts', async () => {
  const back = jest.fn(), view = await render(<Screen back={{ language: 'en', label: 'Back', onPress: back }} />);
  const swipe = await startEdgeSwipe(surface()); await swipe.move(32);
  const release = surface().props.onResponderRelease, event = swipe.releaseEvent(200);
  await view.unmount(); await act(() => release(event)); expect(back).not.toHaveBeenCalled();
});
it('uses the current guarded action after an ordinary screen update', async () => {
  const first = jest.fn(), second = jest.fn();
  const view = await render(<Screen back={{ language: 'en', label: 'Back', onPress: first }} />);
  const swipe = await startEdgeSwipe(surface()); await swipe.move(32);
  await view.rerender(<Screen back={{ language: 'en', label: 'Back', onPress: second }} />);
  await swipe.release(200); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
});
it.each([true, 'unknown'] as const)('leaves VoiceOver/unknown accessibility touch handling alone (%s)', async state => {
  if (state === 'unknown') jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockRejectedValue(new Error('Unavailable native query'));
  else jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  const back = await open(), swipe = await startEdgeSwipe(surface());
  expect(await swipe.move(200)).toBe(false); await swipe.release(); expect(back).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(back).toHaveBeenCalledTimes(1);
});
it('cancels when VoiceOver starts, and ignores an older initial accessibility result', async () => {
  let resolveReader: (value: boolean) => void = noop, updateReader: (value: boolean) => void = noop;
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValue(new Promise(resolve => { resolveReader = resolve; }));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, callback) => {
    updateReader = callback as (value: boolean) => void; return { remove: jest.fn() };
  });
  const back = await open(); await act(() => updateReader(false));
  const swipe = await startEdgeSwipe(surface()); await swipe.move(32);
  await act(async () => { updateReader(true); resolveReader(false); });
  await swipe.release(200); expect(back).not.toHaveBeenCalled();
  const next = await startEdgeSwipe(surface()); expect(await next.move(200)).toBe(false);
});
it('does not attach the edge gesture to Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android'); const back = await open();
  expect(surface().props.onMoveShouldSetResponderCapture).toBeUndefined();
  await fireEvent.press(screen.getByTestId('story-top-back')); expect(back).toHaveBeenCalledTimes(1);
});
it('does not attach a back gesture to root screens', async () => {
  await render(<Screen><Text>Root content</Text></Screen>);
  expect(getComponent(SafeAreaView).props.onMoveShouldSetResponderCapture).toBeUndefined();
});
it.each(['en', 'sv'] as const)('routes Story Details swipe through its existing %s Back handler', async language => {
  const back = jest.fn();
  await render(<StoryDetailsScreen language={language} state={{ status: 'ready', project }}
    onBack={back} onEdit={noop} onRefresh={noop} onSignOut={noop} />);
  await completeEdgeSwipe(surface()); expect(back).toHaveBeenCalledTimes(1);
});
it.each(['en', 'sv'] as const)('keeps story metadata and keyboard safe on attempted swipe in %s', async language => {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true); const dismiss = jest.spyOn(Keyboard, 'dismiss'), back = jest.fn();
  await render(<EditStoryScreen language={language} project={project} state={{ status: 'idle' }} onSubmit={noop} onBack={back} onSignOut={noop} />);
  await fireEvent.changeText(screen.getByLabelText(storyDetailsCopy[language].titleLabel), 'An unsaved title');
  await completeEdgeSwipe(surface()); expect(screen.getByText(leaveCopy[language].dirty)).toBeOnTheScreen();
  expect(dismiss).toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: leaveCopy[language].keep }));
  expect(screen.getByLabelText(storyDetailsCopy[language].titleLabel).props.value).toBe('An unsaved title');
  expect(nativeNodes('scroll')[0].props.automaticallyAdjustKeyboardInsets).toBe(true);
});
it('also covers the separate legacy recording layout without moving its recording panel', async () => {
  const back = jest.fn();
  await render(<ConversationScreen language="en" state={{ status: 'ready', project, session: { id: 'synthetic-session', language: 'en' }, resumed: true }}
    onBack={back} onSignOut={noop} onCheck={noop} recordingPanel={<Text>Existing recording controls</Text>} />);
  await completeEdgeSwipe(surface()); expect(back).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Existing recording controls')).toBeOnTheScreen();
});
