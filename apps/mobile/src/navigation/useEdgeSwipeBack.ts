import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, AppState, PanResponder, Platform, useWindowDimensions, type GestureResponderEvent } from 'react-native';

type Swipe = { x: number; y: number; claimed: boolean };

/** Optional input for the existing Back action; never pops the outer router. */
export function useEdgeSwipeBack(onBack?: () => void) {
  const { width } = useWindowDimensions();
  const enabled = Platform.OS === 'ios' && !!onBack;
  const current = useRef({ onBack, width, enabled });
  const swipe = useRef<Swipe | null>(null), live = useRef(false), reader = useRef(true);
  useLayoutEffect(() => {
    if (current.current.width !== width || current.current.enabled !== enabled) swipe.current = null;
    current.current = { onBack, width, enabled };
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true, changes = 0;
    live.current = true; reader.current = true;
    const app = AppState.addEventListener('change', state => { if (active && state !== 'active') swipe.current = null; });
    let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
    try {
      subscription = AccessibilityInfo.addEventListener('screenReaderChanged', value => {
        if (!active) return;
        changes++; reader.current = value; swipe.current = null;
      });
      // Until this succeeds, visible Back remains the only navigation input.
      void AccessibilityInfo.isScreenReaderEnabled().then(value => {
        if (active && changes === 0) reader.current = value;
      }).catch(() => {});
    } catch { /* Keep VoiceOver's touch gestures available if its state is unknown. */ }
    return () => { active = false; live.current = false; reader.current = true;
      swipe.current = null; subscription?.remove(); app.remove(); };
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) return {};
    const cancel = () => { swipe.current = null; };
    const available = () => live.current && current.current.enabled && !reader.current && AppState.currentState === 'active';
    const movement = (event: GestureResponderEvent) => {
      if (!swipe.current || !available()) { cancel(); return null; }
      const dx = event.nativeEvent.pageX - swipe.current.x, dy = Math.abs(event.nativeEvent.pageY - swipe.current.y);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || dy > 40 || dx < -8 || (dy >= 12 && dy >= Math.abs(dx))) {
        cancel(); return null;
      }
      return { dx, dy };
    };
    // PanResponder.create stores these callbacks; it does not invoke them during render.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: event => {
        cancel();
        const { pageX, pageY, touches } = event.nativeEvent;
        // The existing content has at least a 16-point gutter. Never claim a
        // touch beginning on its text fields, buttons or horizontal controls.
        if (available() && touches.length === 1 && pageX >= 0 && pageX < 16 && Number.isFinite(pageY)) {
          swipe.current = { x: pageX, y: pageY, claimed: false };
        }
        return false;
      },
      onMoveShouldSetPanResponderCapture: event => {
        if (event.nativeEvent.touches.length !== 1) { cancel(); return false; }
        const delta = movement(event);
        return !!delta && delta.dx >= 18 && delta.dx >= delta.dy * 2;
      },
      onPanResponderGrant: () => { if (swipe.current) swipe.current.claimed = true; },
      onPanResponderMove: event => {
        if (event.nativeEvent.touches.length !== 1) cancel(); else movement(event);
      },
      onPanResponderStart: event => { if (event.nativeEvent.touches.length !== 1) cancel(); },
      onPanResponderRelease: event => {
        const claimed = swipe.current?.claimed, delta = movement(event);
        cancel();
        // PanResponder resets its dx on grant: use the original native start
        // coordinates, including the motion before capture, instead.
        const threshold = Math.min(120, Math.max(80, current.current.width / 4));
        if (claimed && delta && event.nativeEvent.touches.length === 0 && delta.dx >= threshold && delta.dx >= delta.dy * 2) {
          current.current.onBack?.();
        }
      },
      onPanResponderReject: cancel,
      onPanResponderTerminate: cancel,
      onPanResponderTerminationRequest: () => { cancel(); return true; },
      onShouldBlockNativeResponder: () => false,
    }).panHandlers;
  }, [enabled]);
}
