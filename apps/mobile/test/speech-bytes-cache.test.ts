import { SpeechBytesCache } from '../src/real-ai/speech-bytes-cache';
import type { SpeechMetadata } from '../src/real-ai/api';
const wave = () => { const bytes = new Uint8Array(64); bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WAVE'), 8); return bytes; };
const metadata = (speechId = 'one'): SpeechMetadata => ({ speech_id: speechId, assistant_message_id: 'assistant', language: 'en', media_type: 'audio/wav', audio_sha256: 'a'.repeat(64), audio_size: 64, expires_at: new Date(Date.now() + 60000).toISOString(), status: 'ready' });
const caches: SpeechBytesCache[] = [];
const makeCache = () => { const cache = new SpeechBytesCache(); caches.push(cache); return cache; };
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
  jest.restoreAllMocks(); jest.useRealTimers();
});
it('copies verified bytes so caller cleanup and playback cannot mutate future replay', () => {
  const cache = makeCache(), value = metadata(), original = wave();
  cache.put(value, original); original.fill(0);
  const replay = cache.get(value)!; expect(String.fromCharCode(...replay.subarray(0, 4))).toBe('RIFF');
  replay.fill(0); expect(String.fromCharCode(...cache.get(value)!.subarray(0, 4))).toBe('RIFF');
});
it('never shares cached audio between workspace instances', () => {
  const first = makeCache(), second = makeCache(), value = metadata();
  first.put(value, wave()); expect(second.get(value)).toBeNull(); first.clear(); expect(first.get(value)).toBeNull();
});
it.each(['assistant_message_id', 'language', 'audio_sha256', 'audio_size', 'expires_at'] as const)('rejects changed %s identity', field => {
  const cache = makeCache(), value = metadata(); cache.put(value, wave());
  expect(cache.get({ ...value, [field]: field === 'audio_size' ? 65 : 'different' } as SpeechMetadata)).toBeNull();
});
it('expires at the metadata deadline and never extends server expiry', () => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now), cache = makeCache(), value = metadata();
  cache.put(value, wave()); clock.mockReturnValue(now + 60001); expect(cache.get(value)).toBeNull();
});
it('limits retention to five minutes even if server metadata lasts longer', () => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now), cache = makeCache();
  const value = { ...metadata(), expires_at: new Date(now + 3600000).toISOString() };
  cache.put(value, wave()); clock.mockReturnValue(now + 300001); expect(cache.get(value)).toBeNull();
});
it('keeps at most two recent clips and rejects invalid or oversized audio', () => {
  const cache = makeCache(), first = metadata('one'), second = metadata('two'), third = metadata('three');
  cache.put(first, wave()); cache.put(second, wave()); cache.put(third, wave());
  expect(cache.get(first)).toBeNull(); expect(cache.get(second)).not.toBeNull(); expect(cache.get(third)).not.toBeNull();
  cache.put(first, new Uint8Array(64)); expect(cache.get(first)).toBeNull();
  cache.put(first, new Uint8Array(10_000_001)); expect(cache.get(first)).toBeNull();
});
it('zeroes owned buffers when privacy cleanup clears the cache', () => {
  const cache = makeCache(), value = metadata(); cache.put(value, wave());
  const fill = jest.spyOn(Uint8Array.prototype, 'fill'); cache.clear();
  expect(fill).toHaveBeenCalledWith(0); expect(cache.get(value)).toBeNull();
});

it('zeroes idle bytes at their exact expiry without a replay or further cache access', () => {
  const cache = makeCache(), value = metadata(); cache.put(value, wave());
  expect(jest.getTimerCount()).toBe(1);
  const fill = jest.spyOn(Uint8Array.prototype, 'fill');
  jest.advanceTimersByTime(60000);
  expect(fill).toHaveBeenCalledWith(0); expect(jest.getTimerCount()).toBe(0);
  expect(cache.get(value)).toBeNull();
});
it('reschedules one expiry timer on replacement and cancels it completely on privacy cleanup', () => {
  const cache = makeCache(), first = metadata('one'), second = { ...metadata('two'), expires_at: new Date(Date.now() + 120000).toISOString() };
  cache.put(first, wave()); cache.put(second, wave()); expect(jest.getTimerCount()).toBe(1);
  cache.put({ ...first, expires_at: new Date(Date.now() + 180000).toISOString() }, wave()); expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(60000); expect(cache.get(second)).not.toBeNull(); expect(jest.getTimerCount()).toBe(1);
  cache.clear(); expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(300000); expect(jest.getTimerCount()).toBe(0);
});
