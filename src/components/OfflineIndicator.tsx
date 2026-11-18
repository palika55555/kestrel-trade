import React from 'react';
import {WifiOff} from 'lucide-react';

interface OfflineIndicatorProps {
  isOnline: boolean;
  lastSyncedAt: number;
  onRestoreOnline?: () => void;
  simulatedOffline?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  isOnline,
  lastSyncedAt,
  onRestoreOnline,
  simulatedOffline,
}) => {
  if (isOnline) return null;

  const syncedTime = new Date(lastSyncedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="fixed bottom-18 lg:bottom-4 left-4 z-40 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-950/95 px-3.5 py-2 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md">
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <div>
        <span>Offline Mode — Viewing cached portfolio</span>
        <span className="text-amber-300/80 ml-1.5 font-mono">· Synced {syncedTime}</span>
      </div>
      {simulatedOffline && onRestoreOnline && (
        <button
          type="button"
          onClick={onRestoreOnline}
          className="ml-2 rounded bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30 transition-colors whitespace-nowrap cursor-pointer"
        >
          Reconnect
        </button>
      )}
    </div>
  );
};
