import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

let nextTag = 0;

export function RecordingWakeLock() {
  useEffect(() => {
    const tag = `memy-recording-${++nextTag}`;
    let stopped = false;
    const activation = activateKeepAwakeAsync(tag);
    void activation.then(() => {
      if (stopped) return deactivateKeepAwake(tag);
    }).catch(() => {});
    return () => {
      stopped = true;
      void deactivateKeepAwake(tag).catch(() => {});
    };
  }, []);
  return null;
}
