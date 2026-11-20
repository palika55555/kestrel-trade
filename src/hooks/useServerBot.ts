import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type {AppendBotLog, EmitNotification} from '../features/market/tickContext';
import type {BrokerStatus, ServerBotState, XauBotConfig} from '../types/trading';

/**
 * State for the 24/7 server-side bot worker and broker bridge. Polling and
 * controls are separate hooks so effect order matches the original App.
 */
export function useServerBotState() {
  const [server247Enabled, setServer247Enabled] = useState<boolean>(false);
  const [serverBotState, setServerBotState] = useState<ServerBotState | null>(null);
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const server247EnabledRef = useRef(server247Enabled);
  server247EnabledRef.current = server247Enabled;
  const botMutationStampRef = useRef<number>(0);
  const userChoseBrowserModeRef = useRef<boolean>(false);

  return {
    server247Enabled,
    setServer247Enabled,
    serverBotState,
    setServerBotState,
    brokerStatus,
    setBrokerStatus,
    server247EnabledRef,
    botMutationStampRef,
    userChoseBrowserModeRef,
  };
}

export type ServerBot = ReturnType<typeof useServerBotState>;

export function useServerBotPolling(isOnline: boolean, serverBot: ServerBot) {
  const {
    setServerBotState,
    setBrokerStatus,
    setServer247Enabled,
    botMutationStampRef,
    userChoseBrowserModeRef,
  } = serverBot;

  // Poll 24/7 Server Bot state (the server persists it on local disk)
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const pullBotState = async () => {
      try {
        const res = await fetch('/api/bot/state');
        if (!res.ok) return;
        const data = (await res.json()) as ServerBotState;
        if (cancelled) return;
        // Avoid overwriting UI with stale poll response right after user toggled bot/mode
        if (Date.now() - botMutationStampRef.current < 1500) {
          return;
        }

        setServerBotState(data);
        if (data.brokerStatus) {
          setBrokerStatus(data.brokerStatus);
        }
        if (data.enabled && !userChoseBrowserModeRef.current) {
          setServer247Enabled(true);
        }
      } catch {
        // Ignore transient network errors
      }
    };
    pullBotState();
    const timer = setInterval(pullBotState, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOnline]);
}

interface ServerBotControlsDeps {
  isOnline: boolean;
  serverBot: ServerBot;
  xauBotConfigRef: RefObject<XauBotConfig>;
  setXauBotConfig: Dispatch<SetStateAction<XauBotConfig>>;
  appendBotLog: AppendBotLog;
  emitNotification: EmitNotification;
}

export function useServerBotControls({
  isOnline,
  serverBot,
  xauBotConfigRef,
  setXauBotConfig,
  appendBotLog,
  emitNotification,
}: ServerBotControlsDeps) {
  const {
    setServer247Enabled,
    setServerBotState,
    setBrokerStatus,
    server247EnabledRef,
    botMutationStampRef,
    userChoseBrowserModeRef,
  } = serverBot;

  // Surfaces a server-side validation rejection in the bot log instead of failing silently.
  const reportRejectedConfig = async (res: Response) => {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {error?: string; details?: string[]};
      detail = body.details?.length ? body.details.join('; ') : body.error || detail;
    } catch {
      // Non-JSON error body; keep the status code
    }
    appendBotLog('RISK', `Server rejected bot config: ${detail}`);
  };

  const syncConfigToBot = useCallback(
    async (next: XauBotConfig) => {
      if (server247EnabledRef.current) {
        // Keep browser loop disabled while 24/7 server worker owns execution
        setXauBotConfig({...next, enabled: false});
        if (!isOnline) return;
        botMutationStampRef.current = Date.now();
        try {
          const res = await fetch('/api/bot/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(next),
          });
          if (res.ok) {
            const data = (await res.json()) as ServerBotState;
            botMutationStampRef.current = Date.now();
            setServerBotState(data);
          } else {
            await reportRejectedConfig(res);
          }
        } catch {
          // Ignore transient error
        }
        return;
      }
      setXauBotConfig(next);
    },
    [isOnline],
  );

  const handleToggleServer247 = useCallback(async () => {
    const nextMode = !server247EnabledRef.current;
    botMutationStampRef.current = Date.now();
    userChoseBrowserModeRef.current = !nextMode;
    setServer247Enabled(nextMode);
    if (nextMode) {
      // Hand off to 24/7 backend worker and pause local browser loop
      const wasBrowserEnabled = xauBotConfigRef.current.enabled;
      const payload = {...xauBotConfigRef.current, enabled: true};
      setXauBotConfig((prev) => ({...prev, enabled: false}));
      try {
        const res = await fetch('/api/bot/config', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          // Server refused the hand-off: stay in browser mode so the bot is not left running nowhere.
          await reportRejectedConfig(res);
          userChoseBrowserModeRef.current = true;
          setServer247Enabled(false);
          setXauBotConfig((prev) => ({...prev, enabled: wasBrowserEnabled}));
          return;
        }
        const data = (await res.json()) as ServerBotState;
        botMutationStampRef.current = Date.now();
        setServerBotState(data);
      } catch {
        // Ignore
      }
      appendBotLog(
        'INFO',
        'Switched to 24/7 Server Worker mode (runs in Node.js backend even if browser closes).',
      );
    } else {
      setXauBotConfig((prev) => ({...prev, enabled: false}));
      try {
        const res = await fetch('/api/bot/config', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({enabled: false}),
        });
        if (res.ok) {
          const data = (await res.json()) as ServerBotState;
          botMutationStampRef.current = Date.now();
          setServerBotState(data);
        }
      } catch {
        // Ignore
      }
      appendBotLog('INFO', 'Switched back to Browser Bot mode.');
    }
  }, [appendBotLog]);

  const handleSyncBroker = async () => {
    try {
      const res = await fetch('/api/broker/sync', {method: 'POST'});
      if (res.ok) {
        setBrokerStatus((await res.json()) as BrokerStatus);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  const handleToggleBrokerRouting = async (armed: boolean) => {
    try {
      const res = await fetch('/api/broker/mode', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({routingArmed: armed}),
      });
      if (res.ok) {
        const nextStatus = (await res.json()) as BrokerStatus;
        setBrokerStatus(nextStatus);
        emitNotification(
          armed ? `Broker Routing ARMED (${nextStatus.provider})` : 'Broker Routing DISARMED',
          armed
            ? `24/7 XAU Bot orders now route to ${nextStatus.accountLabel}.`
            : 'Switched safely back to Paper Simulation ledger.',
          'SYSTEM',
        );
      }
    } catch {
      // Ignore transient network errors
    }
  };

  return {
    syncConfigToBot,
    handleToggleServer247,
    handleSyncBroker,
    handleToggleBrokerRouting,
  };
}
