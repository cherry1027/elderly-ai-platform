import { createMediaPrivacy } from '../src/real-ai/media-privacy';
describe('revoked private media cleanup gate', () => {
  it('retains a failed exact-file capability and blocks another workspace until retry succeeds', async () => {
    const privacy = createMediaPrivacy(); const handle = { dispose: jest.fn<Promise<void>, []>() };
    handle.dispose.mockRejectedValueOnce(new Error('synthetic private path must not escape')).mockResolvedValueOnce(undefined);
    const listener = jest.fn(), unsubscribe = privacy.subscribe(listener);
    const cleanup = privacy.retire(handle); expect(privacy.isBlocked()).toBe(true);
    await expect(cleanup).resolves.toBe(false); expect(privacy.isBlocked()).toBe(true);
    await expect(privacy.retry()).resolves.toBe(true); expect(handle.dispose).toHaveBeenCalledTimes(2);
    expect(privacy.isBlocked()).toBe(false); expect(listener).toHaveBeenCalled(); unsubscribe();
  });
  it('revokes synchronously and deduplicates cleanup while an old driver is settling', async () => {
    const privacy = createMediaPrivacy(); let finish!: () => void, revoked = false;
    const handle = { dispose: jest.fn(() => { revoked = true; return new Promise<void>(resolve => { finish = resolve; }); }) };
    const cleanup = privacy.retire(handle); expect(revoked).toBe(true); const duplicate = privacy.retry();
    expect(handle.dispose).toHaveBeenCalledTimes(1); finish(); await cleanup; await duplicate;
    expect(privacy.isBlocked()).toBe(false);
  });
  it('a second failed resource keeps the gate closed after the first resource is removed', async () => {
    const privacy = createMediaPrivacy(), first = { dispose: jest.fn(async () => {}) }, second = { dispose: jest.fn(async (): Promise<void> => { throw new Error('unavailable'); }) };
    await Promise.all([privacy.retire(first), privacy.retire(second)]); expect(privacy.isBlocked()).toBe(true);
    second.dispose.mockResolvedValueOnce(undefined); await privacy.retry(); expect(privacy.isBlocked()).toBe(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });
});
