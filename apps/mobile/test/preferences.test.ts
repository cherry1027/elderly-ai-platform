import {
  createPreferencesWriter,
  defaultPreferences,
  PREFERENCES_KEY,
  readPreferences,
  STORAGE_TIMEOUT_MS,
} from '../src/onboarding/preferences';

function storage(raw: string | null = null) {
  return {
    getItem: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(raw),
    setItem: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
  };
}

afterEach(() => { jest.useRealTimers(); });

describe('non-sensitive onboarding preferences', () => {
  it('treats no record as first use without a storage warning', async () => {
    const device = storage();
    await expect(readPreferences(device)).resolves.toEqual({ preferences: null, unavailable: false });
    expect(device.getItem).toHaveBeenCalledWith(PREFERENCES_KEY);
    expect(device.setItem).not.toHaveBeenCalled();
  });

  it.each(['en', 'sv'] as const)('loads the selected %s language and completion', async (language) => {
    const preferences = { version: 1, language, completed: true };
    await expect(readPreferences(storage(JSON.stringify(preferences)))).resolves.toEqual({
      preferences, unavailable: false,
    });
  });

  it.each([
    'not JSON', 'null', '[]', '{}',
    '{"version":2,"language":"sv","completed":true}',
    '{"version":1,"language":"de","completed":true}',
    '{"version":1,"language":"en","completed":"true"}',
    '{"version":1,"language":"en"}',
    'x'.repeat(257),
  ])('rejects malformed, unsupported or oversized records safely: %s', async (raw) => {
    await expect(readPreferences(storage(raw))).resolves.toEqual({ preferences: null, unavailable: true });
  });

  it('discards unrelated record fields rather than exposing them to state', async () => {
    const device = storage(JSON.stringify({ ...defaultPreferences, unrelated: 'synthetic extra' }));
    await expect(readPreferences(device)).resolves.toEqual({ preferences: defaultPreferences, unavailable: false });
  });

  it('handles a rejected native read without revealing its message', async () => {
    const device = storage();
    device.getItem.mockRejectedValue(new Error('synthetic private native error'));
    await expect(readPreferences(device)).resolves.toEqual({ preferences: null, unavailable: true });
  });

  it('handles a synchronously failing native read', async () => {
    const device = storage();
    device.getItem.mockImplementation(() => { throw new Error('unavailable'); });
    await expect(readPreferences(device)).resolves.toEqual({ preferences: null, unavailable: true });
  });

  it('bounds a hung read so the introduction cannot remain stuck loading', async () => {
    jest.useFakeTimers();
    const device = storage();
    device.getItem.mockReturnValue(new Promise(() => undefined));
    const read = readPreferences(device);
    await jest.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
    await expect(read).resolves.toEqual({ preferences: null, unavailable: true });
  });

  it('writes only version, language and completion under its dedicated key', async () => {
    const device = storage();
    const write = createPreferencesWriter(device);
    await expect(write({ ...defaultPreferences, language: 'sv', completed: true })).resolves.toBe(true);
    expect(device.setItem).toHaveBeenCalledWith(PREFERENCES_KEY, '{"version":1,"language":"sv","completed":true}');
    expect(device.setItem.mock.calls[0][1]).not.toMatch(/password|token|memory|conversation/i);
  });

  it('snapshots queued preferences before the caller can mutate its object', async () => {
    const device = storage();
    const preferences = { ...defaultPreferences };
    const result = createPreferencesWriter(device)(preferences);
    preferences.language = 'sv';
    await result;
    expect(JSON.parse(device.setItem.mock.calls[0][1]).language).toBe('en');
  });

  it('serializes rapid changes so completion and the latest language are retained', async () => {
    const device = storage();
    let finishFirst!: () => void;
    device.setItem.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const write = createPreferencesWriter(device);
    const first = write({ ...defaultPreferences, language: 'sv' });
    const second = write({ ...defaultPreferences, language: 'sv', completed: true });
    await Promise.resolve();
    expect(device.setItem).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second]);
    expect(JSON.parse(device.setItem.mock.calls[1][1])).toEqual({ version: 1, language: 'sv', completed: true });
  });

  it('allows subsequent writes after a rejection', async () => {
    const device = storage();
    device.setItem.mockRejectedValueOnce(new Error('unavailable'));
    const write = createPreferencesWriter(device);
    await expect(write(defaultPreferences)).resolves.toBe(false);
    await expect(write({ ...defaultPreferences, completed: true })).resolves.toBe(true);
  });

  it('does not let a timed-out old native write race a newer completion', async () => {
    jest.useFakeTimers();
    const device = storage();
    let finishFirst!: () => void;
    device.setItem.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const write = createPreferencesWriter(device);
    const first = write(defaultPreferences);
    await jest.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
    await expect(first).resolves.toBe(false);
    const second = write({ ...defaultPreferences, completed: true });
    await Promise.resolve();
    expect(device.setItem).toHaveBeenCalledTimes(1);
    finishFirst();
    await expect(second).resolves.toBe(true);
    expect(JSON.parse(device.setItem.mock.calls[1][1]).completed).toBe(true);
  });
});
