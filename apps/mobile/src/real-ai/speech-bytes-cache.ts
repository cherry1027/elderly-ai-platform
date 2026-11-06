import type { SpeechMetadata } from './api';

/** Per-workspace verified audio only. Never persisted, shared across owners, or retained across backgrounding. */
export class SpeechBytesCache {
  private readonly entries = new Map<string, { bytes: Uint8Array; expiresAt: number; metadata: string }>();
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduleExpiry(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.entries.size) return;
    const next = Math.min(...Array.from(this.entries.values(), entry => entry.expiresAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.drop(id);
      this.scheduleExpiry();
    }, Math.max(1, next - Date.now()));
  }
  private identity(value: SpeechMetadata): string {
    return [value.speech_id, value.assistant_message_id, value.language, value.audio_sha256, value.audio_size, value.expires_at].join(':');
  }
  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (entry) { this.size -= entry.bytes.length; entry.bytes.fill(0); this.entries.delete(id); }
  }
  get(metadata: SpeechMetadata): Uint8Array | null {
    const entry = this.entries.get(metadata.speech_id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now() || entry.metadata !== this.identity(metadata)) { this.drop(metadata.speech_id); this.scheduleExpiry(); return null; }
    this.entries.delete(metadata.speech_id); this.entries.set(metadata.speech_id, entry);
    return Uint8Array.from(entry.bytes);
  }
  /** Caller must supply the bytes already validated by getRealSpeechAudio. Copies prevent playback cleanup mutating the cache. */
  put(metadata: SpeechMetadata, verified: Uint8Array): void {
    this.drop(metadata.speech_id);
    const expiry = Date.parse(metadata.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || !(verified instanceof Uint8Array) ||
      verified.length !== metadata.audio_size || verified.length < 44 || verified.length > 10_000_000 ||
      String.fromCharCode(...verified.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...verified.subarray(8, 12)) !== 'WAVE') { this.scheduleExpiry(); return; }
    for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.drop(id);
    while (this.entries.size >= 2 || this.size + verified.length > 10_000_000) this.drop(this.entries.keys().next().value!);
    const bytes = Uint8Array.from(verified);
    this.entries.set(metadata.speech_id, { bytes, metadata: this.identity(metadata), expiresAt: Math.min(expiry, Date.now() + 300_000) });
    this.size += bytes.length; this.scheduleExpiry();
  }
  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const id of this.entries.keys()) this.drop(id);
  }
}
