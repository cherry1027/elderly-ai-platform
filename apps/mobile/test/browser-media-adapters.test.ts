import { Blob as NodeBlob } from 'node:buffer';
import { saveBrowserRecording, getBrowserRecordingBlob, discardBrowserRecording, clearBrowserRecordings } from '../src/audio/browser-recordings';
import { createRecordingUpload } from '../src/audio/recording-upload.web';
import { createNativeRecorder } from '../src/audio/native-recorder.web';
import { createSecureSessionStorage, MOBILE_AUTH_STORAGE_KEY } from '../src/auth/secure-storage.web';
import { readWebStaging } from '../src/web-staging';
jest.mock('../src/web-staging', () => ({ readWebStaging: jest.fn(() => ({ webOrigin: 'https://memy-web.example.test', apiOrigin: 'https://memy-api.example.test' })) }));
type Listener = () => void;
const documentListeners = new Map<string, Set<Listener>>(), windowListeners = new Map<string, Set<Listener>>();
const add = (map: Map<string, Set<Listener>>) => (key: string, listener: Listener) => { if (!map.has(key)) map.set(key, new Set()); map.get(key)!.add(listener); };
const remove = (map: Map<string, Set<Listener>>) => (key: string, listener: Listener) => { map.get(key)?.delete(listener); };
const documentFake = { visibilityState: 'visible', addEventListener: add(documentListeners), removeEventListener: remove(documentListeners) };
const windowFake = { addEventListener: add(windowListeners), removeEventListener: remove(windowListeners) };
const track = { stop: jest.fn(), onended: null as null | (() => void) };
const stream = { getTracks: () => [track] };
const getUserMedia = jest.fn(async () => stream);
let nextUrl = 0;
const createObjectURL = jest.fn(() => `blob:synthetic-${++nextUrl}`), revokeObjectURL = jest.fn();
class FakeRecorder {
  static isTypeSupported = () => true;
  static instances: FakeRecorder[] = [];
  state = 'inactive'; mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(_stream: unknown, options: {mimeType: string}) { this.mimeType = options.mimeType; FakeRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
class CapturedFormData { entries: unknown[][] = []; append(...args: unknown[]) { this.entries.push(args); } }
const originals = new Map<string, PropertyDescriptor | undefined>();
function install(key: string, value: unknown) { if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
beforeAll(() => {
  install('document', documentFake); install('window', windowFake); install('navigator', { mediaDevices: { getUserMedia } });
  install('Blob', NodeBlob); install('FormData', CapturedFormData); install('MediaRecorder', FakeRecorder);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});
beforeEach(() => { documentFake.visibilityState = 'visible'; FakeRecorder.instances = []; getUserMedia.mockResolvedValue(stream); jest.mocked(readWebStaging).mockReturnValue({ webOrigin: 'https://memy-web.example.test', apiOrigin: 'https://memy-api.example.test' }); });
afterEach(() => { jest.useRealTimers(); });
afterAll(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
it('keeps browser login only in RAM, rejects foreign keys and clears retired storage', async () => {
  const storage = createSecureSessionStorage(); await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'synthetic-session');
  expect(await storage.getItem(MOBILE_AUTH_STORAGE_KEY)).toBe('synthetic-session');
  await expect(storage.getItem('another-project')).rejects.toThrow(); storage.close();
  await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).rejects.toThrow(); await storage.clear();
  const next = createSecureSessionStorage(); expect(await next.getItem(MOBILE_AUTH_STORAGE_KEY)).toBeNull(); await next.clear();
});
it.each(['audio/webm', 'audio/mp4'])('uploads the exact owned %s Blob with consent fields', type => {
  const owner = {}, recording = saveBrowserRecording(new Blob(['synthetic audio'], { type }), owner, 1000);
  const data = createRecordingUpload(recording, 'sv', () => { throw new Error('invalid'); }) as unknown as CapturedFormData;
  expect(data.entries[0]).toEqual(['file', getBrowserRecordingBlob(recording), type === 'audio/webm' ? 'recording.webm' : 'recording.m4a']);
  expect(data.entries.slice(1)).toEqual([['language', 'sv'], ['consent', 'true']]); clearBrowserRecordings(owner);
  expect(() => getBrowserRecordingBlob(recording)).toThrow();
});
it('rejects foreign/tampered files, enforces owner cleanup and never uses native File', () => {
  const owner = {}, recording = saveBrowserRecording(new Blob(['synthetic'], { type: 'audio/webm' }), owner, 1000);
  discardBrowserRecording(recording, {}); expect(getBrowserRecordingBlob(recording)).toBeInstanceOf(Blob);
  expect(() => createRecordingUpload({ ...recording, size: 1 }, 'en', () => { throw new Error('invalid'); })).toThrow('invalid');
  expect(() => createRecordingUpload({ ...recording, uri: 'blob:foreign' }, 'en', () => { throw new Error('invalid'); })).toThrow('invalid');
  clearBrowserRecordings(owner); expect(revokeObjectURL).toHaveBeenCalledWith(recording.uri);
});
it('requires an approved secure foreground before requesting microphone permission or upload', async () => {
  jest.mocked(readWebStaging).mockReturnValue(null); const recorder = createNativeRecorder();
  expect(await recorder.requestPermission()).toBe(false); expect(getUserMedia).not.toHaveBeenCalled(); await recorder.dispose();
  const owner = {}, recording = saveBrowserRecording(new Blob(['audio'], { type: 'audio/mp4' }), owner, 1000);
  expect(() => createRecordingUpload(recording, 'en', () => { throw new Error('invalid'); })).toThrow('invalid'); clearBrowserRecordings(owner);
});
it('deduplicates permission prompts, saves genuine capture, stops tracks and revokes on departure', async () => {
  const recorder = createNativeRecorder(); await Promise.all([recorder.requestPermission(), recorder.requestPermission()]);
  expect(getUserMedia).toHaveBeenCalledTimes(1); await recorder.start(); const native = FakeRecorder.instances[0];
  native.ondataavailable?.({ data: new Blob(['actual synthetic captured bytes'], { type: 'audio/webm' }) });
  const recording = await recorder.stop(); expect(recording.type).toBe('audio/webm'); expect(recording.durationMs).toBeGreaterThan(0);
  expect(track.stop).toHaveBeenCalled(); expect(getBrowserRecordingBlob(recording).size).toBe(recording.size);
  for (const listener of windowListeners.get('pagehide') ?? []) listener();
  expect(() => getBrowserRecordingBlob(recording)).toThrow(); await recorder.dispose();
});
it('interrupts background capture without producing a false saved recording or automatic upload', async () => {
  const recorder = createNativeRecorder(); await recorder.requestPermission(); await recorder.start();
  const native = FakeRecorder.instances[0], staleStop = native.onstop;
  native.ondataavailable?.({ data: new Blob(['synthetic'], { type: 'audio/webm' }) });
  documentFake.visibilityState = 'hidden'; for (const listener of documentListeners.get('visibilitychange') ?? []) listener();
  await expect(recorder.stop()).rejects.toMatchObject({ stage: 'interrupted' }); expect(track.stop).toHaveBeenCalled();
  documentFake.visibilityState = 'visible'; await recorder.requestPermission(); await recorder.start();
  const stops = track.stop.mock.calls.length; staleStop?.(); expect(track.stop.mock.calls.length).toBe(stops);
  await recorder.dispose(); expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('cancels a permission grant that arrives after disposal and stops its tracks', async () => {
  let resolve!: (value: typeof stream) => void; getUserMedia.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const recorder = createNativeRecorder(), permission = recorder.requestPermission(); await recorder.dispose(); resolve(stream);
  expect(await permission).toBe(false); expect(track.stop).toHaveBeenCalled();
});
