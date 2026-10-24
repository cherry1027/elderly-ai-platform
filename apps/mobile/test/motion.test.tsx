import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '../src/useReducedMotion';

describe('device reduced motion', () => {
  let onChange: (enabled: boolean) => void;
  let remove: jest.Mock;

  beforeEach(() => {
    remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
      expect(event).toBe('reduceMotionChanged');
      // Jest infers RN's last (announcement) overload, but this test observes
      // only the asserted boolean reduceMotionChanged subscription.
      onChange = listener as unknown as (enabled: boolean) => void;
      return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts with static artwork before the asynchronous preference is known', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it.each([true, false])('respects device reduced-motion setting %s', async (enabled) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(enabled);
    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(enabled));
  });

  it('updates immediately when the user changes the setting', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));
    await act(() => onChange(true));
    expect(result.current).toBe(true);
    await act(() => onChange(false));
    expect(result.current).toBe(false);
  });

  it('does not overwrite a newer setting-change event with a stale initial response', async () => {
    let resolve: (enabled: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    const { result } = await renderHook(() => useReducedMotion());
    await act(() => onChange(true));
    await act(async () => resolve(false));
    expect(result.current).toBe(true);
  });

  it('stays static when reading the device setting fails', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('Unavailable'));
    const { result } = await renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it('stays static when reading the device setting throws synchronously', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('stays static when changes cannot be observed', async () => {
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    const initialRead = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    expect(initialRead).not.toHaveBeenCalled();
  });

  it('removes its listener and safely ignores late asynchronous results', async () => {
    let resolve: (enabled: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise((done) => {
      resolve = done;
    }));
    const view = await renderHook(() => useReducedMotion());
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => resolve(false));
  });
});
