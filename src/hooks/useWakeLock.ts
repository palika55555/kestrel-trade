import {useEffect, useState} from 'react';
import type {XauBotConfig} from '../types/trading';

/**
 * Holds a Screen Wake Lock while the browser-mode bot runs so the device
 * does not sleep. Returns whether the lock is currently held.
 */
export function useWakeLock(xauBotConfig: XauBotConfig, server247Enabled: boolean) {
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  // Acquire Browser Screen Wake Lock while Browser Bot runs so device doesn't sleep
  useEffect(() => {
    const shouldLock = xauBotConfig.enabled && !server247Enabled;
    if (!shouldLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockActive(false);
      return;
    }
    let sentinel: {release: () => Promise<void>} | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const wl = await (
          navigator as Navigator & {
            wakeLock?: {request: (t: 'screen') => Promise<{release: () => Promise<void>}>};
          }
        ).wakeLock?.request('screen');
        if (!cancelled && wl) {
          sentinel = wl;
          setWakeLockActive(true);
        }
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };

    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      sentinel?.release().catch(() => {});
      setWakeLockActive(false);
    };
  }, [xauBotConfig.enabled, server247Enabled]);

  return wakeLockActive;
}
