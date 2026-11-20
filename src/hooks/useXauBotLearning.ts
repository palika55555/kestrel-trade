import {useCallback, type Dispatch, type RefObject, type SetStateAction} from 'react';
import type {EmitNotification} from '../features/market/tickContext';
import {adaptBotFromTradeHistory} from '../services/xauBot';
import type {
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../types/trading';

interface XauBotLearningDeps {
  setXauBotLogs: Dispatch<SetStateAction<XauBotLogEntry[]>>;
  setXauBotTrades: Dispatch<SetStateAction<XauBotTradeRecord[]>>;
  setXauBotConfig: Dispatch<SetStateAction<XauBotConfig>>;
  setXauBotAdaptations: Dispatch<SetStateAction<XauBotAdaptationEvent[]>>;
  xauBotTradesRef: RefObject<XauBotTradeRecord[]>;
  xauBotConfigRef: RefObject<XauBotConfig>;
  emitNotification: EmitNotification;
}

/**
 * Browser bot activity log plus closed-trade recording and the auto-learning
 * parameter adaptation loop.
 */
export function useXauBotLearning({
  setXauBotLogs,
  setXauBotTrades,
  setXauBotConfig,
  setXauBotAdaptations,
  xauBotTradesRef,
  xauBotConfigRef,
  emitNotification,
}: XauBotLearningDeps) {
  const appendBotLog = useCallback(
    (level: XauBotLogEntry['level'], message: string) => {
      const entry: XauBotLogEntry = {
        id: `botlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        level,
        message,
      };
      setXauBotLogs((prev) => [entry, ...prev].slice(0, 60));
    },
    [],
  );

  const recordClosedBotTradesAndLearn = useCallback(
    (newlyClosed: XauBotTradeRecord[], forceOptimize = false) => {
      const combined = [...newlyClosed, ...xauBotTradesRef.current].slice(0, 250);
      if (newlyClosed.length > 0) {
        setXauBotTrades(combined);
      }

      const currentCfg = xauBotConfigRef.current;
      if ((currentCfg.autoLearnEnabled || forceOptimize) && combined.length >= 2) {
        const {nextConfig, event} = adaptBotFromTradeHistory(currentCfg, combined);
        if (event) {
          setXauBotConfig(nextConfig);
          setXauBotAdaptations((prev) => [event, ...prev].slice(0, 60));
          appendBotLog(
            'LEARN',
            `Auto-improved after #${event.triggerTradeCount}: ${event.summary} (${event.reason})`,
          );
          emitNotification(
            'XAU/USD Bot Self-Optimized',
            event.summary,
            'SYSTEM',
            'XAU/USD',
            'alert',
          );
        } else if (forceOptimize) {
          appendBotLog(
            'LEARN',
            'Optimization check complete: current parameters already match recent performance.',
          );
        }
      }
    },
    [appendBotLog, emitNotification],
  );

  return {appendBotLog, recordClosedBotTradesAndLearn};
}
