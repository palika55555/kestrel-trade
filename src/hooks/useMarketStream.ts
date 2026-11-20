import {useEffect, useState} from 'react';
import {processMarketTick as applyMarketTick} from '../features/market/processMarketTick';
import type {
  AppendBotLog,
  EmitNotification,
  MarketTickBindings,
  MarketTickContext,
  MarketTickPayload,
  RecordClosedBotTrades,
} from '../features/market/tickContext';
import type {Instrument} from '../types/trading';

/**
 * Real-time market stream: SSE `/api/stream` with automatic fallback to
 * polling `/api/markets`. Every tick is fed through the tick engine.
 * Returns whether the stream is currently delivering data.
 */
export function useMarketStream(
  isOnline: boolean,
  bindings: MarketTickBindings,
  emitNotification: EmitNotification,
  appendBotLog: AppendBotLog,
  recordClosedBotTradesAndLearn: RecordClosedBotTrades,
) {
  const [streamConnected, setStreamConnected] = useState<boolean>(false);

  // Connect to Real-Time SSE Market Stream when online (with automatic HTTP/2 fallback to /api/markets)
  useEffect(() => {
    if (!isOnline) {
      setStreamConnected(false);
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retrySseTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveSseErrors = 0;

    const ctx: MarketTickContext = {
      ...bindings,
      setStreamConnected,
      emitNotification,
      appendBotLog,
      recordClosedBotTradesAndLearn,
    };
    const processMarketTick = (payload: MarketTickPayload) => applyMarketTick(ctx, payload);

    const startHttpFallback = () => {
      if (cancelled || pollTimer) return;
      const pullOnce = async () => {
        if (cancelled) return;
        try {
          const res = await fetch('/api/markets');
          if (!res.ok) return;
          const data = (await res.json()) as {
            timestamp: number;
            instruments: Instrument[];
          };
          if (!cancelled) processMarketTick(data);
        } catch {
          if (!cancelled) setStreamConnected(false);
        }
      };
      void pullOnce();
      pollTimer = setInterval(pullOnce, 1000);
    };

    const stopHttpFallback = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connectSse = () => {
      if (cancelled) return;
      es?.close();
      es = new EventSource('/api/stream');
      es.onopen = () => {
        consecutiveSseErrors = 0;
        stopHttpFallback();
        if (!cancelled) setStreamConnected(true);
      };
      es.onmessage = (event) => {
        consecutiveSseErrors = 0;
        stopHttpFallback();
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            timestamp: number;
            instruments: Instrument[];
          };
          processMarketTick(payload);
        } catch {
          // Ignore malformed SSE JSON frame
        }
      };
      es.onerror = () => {
        consecutiveSseErrors += 1;
        if (consecutiveSseErrors >= 2) {
          es?.close();
          es = null;
          startHttpFallback();
          if (!retrySseTimer && !cancelled) {
            retrySseTimer = setTimeout(() => {
              retrySseTimer = null;
              consecutiveSseErrors = 0;
              connectSse();
            }, 30_000);
          }
        } else {
          if (!cancelled) setStreamConnected(false);
        }
      };
    };

    connectSse();

    return () => {
      cancelled = true;
      es?.close();
      stopHttpFallback();
      if (retrySseTimer) clearTimeout(retrySseTimer);
      setStreamConnected(false);
    };
  }, [isOnline, emitNotification, appendBotLog, recordClosedBotTradesAndLearn]);

  return streamConnected;
}
