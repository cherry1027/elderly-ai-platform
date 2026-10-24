import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { LanguageProvider, useLanguage } from '../src/language';
import { PREFERENCES_KEY, STORAGE_TIMEOUT_MS } from '../src/onboarding/preferences';

// Use the same global device mock as the provider; replacing its factory here
// can leave a module loaded during setup holding a different storage instance.
const device = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function Probe() {
  const state = useLanguage();
  return <>
    <Text>{state.ready ? 'ready' : 'loading'}</Text>
    <Text>{state.language}</Text>
    <Text>{state.completed ? 'completed' : 'first use'}</Text>
    <Text>{state.storageUnavailable ? 'storage warning' : 'storage available'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Swedish" onPress={() => state.setLanguage('sv')} />
    <Pressable accessibilityRole="button" accessibilityLabel="English" onPress={() => state.setLanguage('en')} />
    <Pressable accessibilityRole="button" accessibilityLabel="Complete" onPress={() => { void state.completeIntroduction(); }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Rapid changes" onPress={() => {
      state.setLanguage('sv');
      void state.completeIntroduction();
      state.setLanguage('en');
    }} />
  </>;
}

async function openProvider() {
  const view = await render(<LanguageProvider><Probe /></LanguageProvider>);
  await screen.findByText('ready');
  return view;
}

beforeEach(() => {
  device.getItem.mockReset().mockResolvedValue(null);
  device.setItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => { jest.useRealTimers(); });

describe('persistent language and introduction provider', () => {
  it('waits for loading, then starts the first-use flow in English', async () => {
    let finish!: (value: string | null) => void;
    device.getItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('loading')).toBeOnTheScreen();
    await act(() => finish(null));
    await screen.findByText('ready');
    expect(screen.getByText('en')).toBeOnTheScreen();
    expect(screen.getByText('first use')).toBeOnTheScreen();
    expect(screen.getByText('storage available')).toBeOnTheScreen();
    expect(device.setItem).not.toHaveBeenCalled();
  });

  it('restores returning visitors and their Swedish preference', async () => {
    device.getItem.mockResolvedValue('{"version":1,"language":"sv","completed":true}');
    await openProvider();
    expect(screen.getByText('sv')).toBeOnTheScreen();
    expect(screen.getByText('completed')).toBeOnTheScreen();
    expect(device.setItem).not.toHaveBeenCalled();
  });

  it('changes language without clearing a previously completed introduction', async () => {
    device.getItem.mockResolvedValue('{"version":1,"language":"en","completed":true}');
    await openProvider();
    await fireEvent.press(screen.getByRole('button', { name: 'Swedish' }));
    expect(screen.getByText('sv')).toBeOnTheScreen();
    expect(screen.getByText('completed')).toBeOnTheScreen();
    await waitFor(() => expect(device.setItem).toHaveBeenLastCalledWith(PREFERENCES_KEY, '{"version":1,"language":"sv","completed":true}'));
  });

  it('marks completion immediately while a native save is pending', async () => {
    let finish!: () => void;
    device.setItem.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await openProvider();
    await fireEvent.press(screen.getByRole('button', { name: 'Complete' }));
    expect(screen.getByText('completed')).toBeOnTheScreen();
    await waitFor(() => expect(device.setItem).toHaveBeenCalledTimes(1));
    await act(async () => { finish(); });
  });

  it('keeps current-session completion and reports an unavailable save', async () => {
    device.setItem.mockRejectedValue(new Error('synthetic native failure'));
    await openProvider();
    await fireEvent.press(screen.getByRole('button', { name: 'Complete' }));
    await screen.findByText('storage warning');
    expect(screen.getByText('completed')).toBeOnTheScreen();
    expect(screen.queryByText(/synthetic native failure/)).toBeNull();
  });

  it('can continue after a failed read without exposing its native error', async () => {
    device.getItem.mockRejectedValue(new Error('synthetic private error'));
    await openProvider();
    expect(screen.getByText('storage warning')).toBeOnTheScreen();
    expect(screen.getByText('first use')).toBeOnTheScreen();
    expect(screen.queryByText(/synthetic private error/)).toBeNull();
  });

  it('handles a corrupt stored record conservatively', async () => {
    device.getItem.mockResolvedValue('{"version":99,"language":"sv","completed":true}');
    await openProvider();
    expect(screen.getByText('en')).toBeOnTheScreen();
    expect(screen.getByText('first use')).toBeOnTheScreen();
    expect(screen.getByText('storage warning')).toBeOnTheScreen();
  });

  it('does not accept writes before stored preferences have been loaded', async () => {
    let finishRead!: (raw: string | null) => void;
    device.getItem.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await fireEvent.press(screen.getByRole('button', { name: 'Swedish' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete' }));
    expect(device.setItem).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      finishRead('{"version":1,"language":"sv","completed":true}');
    });
    expect(screen.getByText('sv')).toBeOnTheScreen();
    expect(screen.getByText('completed')).toBeOnTheScreen();
  });

  it('bounds a stuck read and ignores a late hydration result', async () => {
    jest.useFakeTimers();
    let finishRead!: (raw: string | null) => void;
    device.getItem.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await act(async () => { await jest.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS); });
    expect(screen.getByText('ready')).toBeOnTheScreen();
    expect(screen.getByText('storage warning')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Swedish' }));
    await act(async () => { finishRead('{"version":1,"language":"en","completed":false}'); });
    expect(screen.getByText('sv')).toBeOnTheScreen();
  });

  it('saves rapid language and completion changes in order without stale state', async () => {
    await openProvider();
    await fireEvent.press(screen.getByRole('button', { name: 'Rapid changes' }));
    expect(screen.getByText('en')).toBeOnTheScreen();
    expect(screen.getByText('completed')).toBeOnTheScreen();
    await waitFor(() => expect(device.setItem).toHaveBeenCalledTimes(3));
    expect(JSON.parse(device.setItem.mock.calls[2][1])).toEqual({ version: 1, language: 'en', completed: true });
  });

  it('restores persisted preferences when the provider is mounted again', async () => {
    const values = new Map<string, string>();
    device.getItem.mockImplementation(async (key) => values.get(key) ?? null);
    device.setItem.mockImplementation(async (key, value) => { values.set(key, value); });
    const first = await openProvider();
    await fireEvent.press(screen.getByRole('button', { name: 'Swedish' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(device.setItem).toHaveBeenCalledTimes(2));
    await first.unmount();
    await openProvider();
    expect(screen.getByText('sv')).toBeOnTheScreen();
    expect(screen.getByText('completed')).toBeOnTheScreen();
    expect([...values.keys()]).toEqual([PREFERENCES_KEY]);
  });
});
