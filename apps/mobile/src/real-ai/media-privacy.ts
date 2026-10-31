type DisposableMedia = { dispose(): Promise<void> };
/** Retain only revoked native capabilities until exact-file cleanup succeeds.
 * No content, URI, token or account configuration is exposed by this service. */
export function createMediaPrivacy() {
  const pending = new Set<DisposableMedia>(), running = new Map<DisposableMedia, Promise<boolean>>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const dispose = (resource: DisposableMedia): Promise<boolean> => {
    const previous = running.get(resource); if (previous) return previous;
    pending.add(resource); changed();
    let operation: Promise<void>;
    // Invoke now, so the driver's synchronous revoke/pause fence runs before navigation.
    try { operation = resource.dispose(); } catch { operation = Promise.reject(new Error('Private media cleanup failed.')); }
    const result = Promise.resolve(operation).then(() => { pending.delete(resource); return true; }, () => false)
      .finally(() => { running.delete(resource); changed(); });
    running.set(resource, result); return result;
  };
  return {
    isBlocked: () => pending.size > 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retire: dispose,
    async retry() { return (await Promise.all([...pending].map(dispose))).every(Boolean); },
  };
}
export const mediaPrivacy = createMediaPrivacy();
