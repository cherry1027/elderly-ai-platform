import { createRealPlayback, type PlaybackDependencies } from '../src/real-ai/native-playback';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let callback: ((value: { didJustFinish: boolean }) => void) | null = null;
  let exists = false, size = 0;
  const file = { uri: 'file:///synthetic-private-cache/reply.wav', get exists() { return exists; }, get size() { return size; },
    create: jest.fn(() => { exists = true; }), write: jest.fn(async (bytes: Uint8Array) => { size = bytes.length; }),
    delete: jest.fn(() => { exists = false; }) };
  const player = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(),
    addListener: jest.fn((_event: 'playbackStatusUpdate', next: (value: { didJustFinish: boolean }) => void) => { callback = next; return { remove: jest.fn() }; }) };
  const dependencies = { foreground: jest.fn(() => true), mode: jest.fn(async () => {}), file: jest.fn(() => file), player: jest.fn(() => player) } satisfies PlaybackDependencies;
  return { dependencies, file, player, driver: createRealPlayback(dependencies), emit: () => callback?.({ didJustFinish: true }) };
}
const wav = () => { const bytes = new Uint8Array(64); bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WAVE'), 8); return bytes; };
async function flush() { for (let index = 0; index < 15; index++) await Promise.resolve(); }
describe('owned speech playback with injected synthetic native IO', () => {
  it('awaits the SDK58 private file write before creating or playing the native player', async () => {
    const f = fixture(), writing = deferred(); f.file.write.mockImplementationOnce(async bytes => { await writing.promise; Object.defineProperty(f.file, 'size', { configurable: true, value: bytes.length }); });
    const result = f.driver.play(wav(), jest.fn()); await flush();
    expect(f.player.play).not.toHaveBeenCalled(); writing.resolve(); await result;
    expect(f.dependencies.player).toHaveBeenCalledWith(f.file.uri); expect(f.player.play).toHaveBeenCalledTimes(1);
    await f.driver.dispose(); expect(f.file.delete).toHaveBeenCalledTimes(1);
  });
  it('stops synchronously before cleanup so the microphone does not record the AI voice', async () => {
    const f = fixture(); await f.driver.play(wav(), jest.fn()); const stopped = f.driver.stop();
    expect(f.player.pause).toHaveBeenCalled(); await stopped; expect(f.player.remove).toHaveBeenCalled(); expect(f.file.delete).toHaveBeenCalled();
  });
  it('revokes a pending mode/file operation before late callbacks can start playback', async () => {
    const f = fixture(), mode = deferred(); f.dependencies.mode.mockReturnValueOnce(mode.promise);
    const result = f.driver.play(wav(), jest.fn()); await flush(); const disposed = f.driver.dispose(); mode.resolve();
    await expect(result).rejects.toThrow('safely'); await disposed;
    expect(f.dependencies.file).not.toHaveBeenCalled(); expect(f.player.play).not.toHaveBeenCalled();
  });
  it('cleans only its owned file on natural completion and retires the late callback', async () => {
    const f = fixture(), finish = jest.fn(); await f.driver.play(wav(), finish); f.emit(); await flush();
    expect(finish).toHaveBeenCalledTimes(1); expect(f.file.delete).toHaveBeenCalledTimes(1);
    f.emit(); await flush(); expect(finish).toHaveBeenCalledTimes(1); await f.driver.dispose();
  });
  it('does not play in background or accept non-WAV/fabricated media', async () => {
    const f = fixture(); f.dependencies.foreground.mockReturnValue(false);
    await expect(f.driver.play(wav(), jest.fn())).rejects.toThrow('safely');
    f.dependencies.foreground.mockReturnValue(true);
    await expect(f.driver.play(new Uint8Array(64), jest.fn())).rejects.toThrow('safely');
    expect(f.dependencies.mode).not.toHaveBeenCalled(); expect(f.player.play).not.toHaveBeenCalled();
  });
  it('fences a foreground transition that occurs while the file is being written', async () => {
    const f = fixture(), write = deferred(); f.file.write.mockImplementationOnce(async () => { await write.promise; });
    const result = f.driver.play(wav(), jest.fn()); await flush(); f.dependencies.foreground.mockReturnValue(false); write.resolve();
    await expect(result).rejects.toThrow('safely'); expect(f.player.play).not.toHaveBeenCalled(); expect(f.file.delete).toHaveBeenCalled();
  });
});
