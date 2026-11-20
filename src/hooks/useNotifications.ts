import {useCallback, useState, type Dispatch, type SetStateAction} from 'react';
import {
  dispatchBrowserPushNotification,
  getNotificationPermission,
  playAlertChime,
  type PushPermissionState,
} from '../services/notifications';
import type {AlertNotification, RiskSettings} from '../types/trading';

/**
 * In-app notification center feed, transient toast stack, audio chime and
 * browser push dispatch.
 */
export function useNotifications(
  riskSettings: RiskSettings,
  setNotifications: Dispatch<SetStateAction<AlertNotification[]>>,
) {
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(() =>
    getNotificationPermission(),
  );
  const [toastQueue, setToastQueue] = useState<AlertNotification[]>([]);

  const emitNotification = useCallback(
    (
      title: string,
      body: string,
      category: AlertNotification['category'],
      symbol?: string,
      chimeType: 'alert' | 'fill' | 'warning' = 'alert',
    ) => {
      const note: AlertNotification = {
        id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        category,
        symbol,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications((prev) => [note, ...prev].slice(0, 80));
      setToastQueue((prev) => [note, ...prev].slice(0, 3));
      setTimeout(() => {
        setToastQueue((prev) => prev.filter((t) => t.id !== note.id));
      }, 5200);

      if (riskSettings.enableAudioChime) {
        playAlertChime(chimeType);
      }
      if (riskSettings.enablePushNotifications) {
        dispatchBrowserPushNotification(title, body, note.id);
      }
    },
    [riskSettings.enableAudioChime, riskSettings.enablePushNotifications],
  );

  return {
    emitNotification,
    toastQueue,
    setToastQueue,
    pushPermission,
    setPushPermission,
  };
}
