import { act } from '@testing-library/react-native';
import type { GestureResponderEvent, NativeTouchEvent } from 'react-native';
import type { TestInstance } from 'test-renderer';

/** Native touch history drives the real PanResponder, including its grant reset. */
export async function startEdgeSwipe(surface: TestInstance, startX = 8, startY = 200) {
  let x = startX, y = startY, time = 1, count = 1, granted = false;
  const event = (nextX: number, nextY: number, touches = count) => {
    const previousX = x, previousY = y, previousTime = time;
    x = nextX; y = nextY; time += 16; count = touches;
    const touch: NativeTouchEvent = { identifier: 0, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: time, target: 1,
      touches: [], changedTouches: [] };
    const frame: GestureResponderEvent = {
      bubbles: true, cancelable: true, currentTarget: 1, target: 1, defaultPrevented: false,
      dispatchConfig: { registrationName: 'onTouchMove' }, eventPhase: 3, isTrusted: true, timeStamp: time, type: 'touch',
      preventDefault: () => {}, stopPropagation: () => {}, persist: () => {},
      isDefaultPrevented: () => false, isPropagationStopped: () => false,
      nativeEvent: { ...touch, touches: Array.from({ length: touches }, (_, identifier) => ({ ...touch, identifier })), changedTouches: [touch] },
      touchHistory: { numberActiveTouches: touches, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time,
        touchBank: Array.from({ length: Math.max(1, touches) }, () => ({ touchActive: touches > 0,
          startPageX: startX, startPageY: startY, startTimeStamp: 1,
          currentPageX: x, currentPageY: y, currentTimeStamp: time,
          previousPageX: previousX, previousPageY: previousY, previousTimeStamp: previousTime })) },
    };
    return frame;
  };
  const send = async (name: string, frame: GestureResponderEvent) => {
    let result: unknown;
    // fireEvent intentionally discards callback return values. Native responder
    // negotiation needs the actual boolean to decide whether to deliver grant.
    await act(() => { result = surface.props[name](frame); });
    return result;
  };
  await send('onStartShouldSetResponderCapture', event(x, y));
  return {
    async move(nextX: number, nextY = startY) {
      const move = event(nextX, nextY);
      if (granted) { await send('onResponderMove', move); return true; }
      const claim = await send('onMoveShouldSetResponderCapture', move);
      if (claim) { await send('onResponderGrant', move); granted = true; }
      return !!claim;
    },
    async release(nextX = x, nextY = y) {
      const release = event(nextX, nextY, 0);
      if (granted) await send('onResponderRelease', release);
    },
    async terminate() { await send('onResponderTerminate', event(x, y, 0)); },
    async touches(number: number) {
      await send(granted ? 'onResponderStart' : 'onStartShouldSetResponderCapture', event(x, y, number));
    },
    releaseEvent(nextX = x, nextY = y) { return event(nextX, nextY, 0); },
  };
}

export async function completeEdgeSwipe(surface: TestInstance) {
  const swipe = await startEdgeSwipe(surface);
  await swipe.move(32); await swipe.move(200); await swipe.release();
}
