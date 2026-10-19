import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Stay still until the device explicitly permits motion, including failures. */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let active = true;
    let changes = 0;
    let subscription: ReturnType<typeof AccessibilityInfo.addEventListener>;

    try {
      subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
        changes += 1;
        if (active) setReducedMotion(enabled);
      });
    } catch {
      // If changes cannot be observed, keep the conservative static fallback.
      return;
    }

    try {
      void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
        // A setting-change event is newer than this asynchronous initial read.
        if (active && changes === 0) setReducedMotion(enabled);
      }).catch(() => {
        if (active && changes === 0) setReducedMotion(true);
      });
    } catch {
      // The initial state is already the conservative static fallback.
    }

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
