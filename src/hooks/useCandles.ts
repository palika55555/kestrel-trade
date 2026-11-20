import {useEffect, useState} from 'react';
import {loadCachedCandles, saveCachedCandles} from '../services/offlineStorage';
import type {Candle, Instrument, Timeframe} from '../types/trading';
import {useLatestRef} from './useLatestRef';

/**
 * Chart candles for the selected symbol/timeframe (with IndexedDB offline
 * fallback) plus background 5m candles for every instrument.
 */
export function useCandles(
  selectedSymbol: string,
  timeframe: Timeframe,
  isOnline: boolean,
  instruments: Instrument[],
  brokerProvider?: string,
  brokerLastSyncedAt?: number | null,
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesBySymbol, setCandlesBySymbol] = useState<Record<string, Candle[]>>({});

  const candlesBySymbolRef = useLatestRef(candlesBySymbol);
  const candlesRef = useLatestRef(candles);
  const selectedDataSource = instruments.find((i) => i.symbol === selectedSymbol)?.dataSource;
  const isMt5Live =
    selectedSymbol === 'XAU/USD' &&
    (brokerProvider === 'MT5' || selectedDataSource === 'MT5 Live Broker');

  // Fetch candles when symbol, timeframe, or live broker feed changes (with periodic live refresh)
  useEffect(() => {
    let cancelled = false;
    const pullCandles = async (useOfflineCache: boolean) => {
      if (useOfflineCache) {
        const cached = await loadCachedCandles(selectedSymbol, timeframe);
        if (cached && cached.length > 0 && !cancelled) {
          setCandles(cached);
          setCandlesBySymbol((prev) => ({...prev, [selectedSymbol]: cached}));
        }
      }
      if (!isOnline) return;
      try {
        const res = await fetch(
          `/api/candles/${encodeURIComponent(selectedSymbol)}?timeframe=${timeframe}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {candles: Candle[]};
        if (!cancelled && data.candles?.length) {
          setCandles(data.candles);
          setCandlesBySymbol((prev) => ({...prev, [selectedSymbol]: data.candles}));
          saveCachedCandles(selectedSymbol, timeframe, data.candles);
        }
      } catch {
        // Retain cached candles if offline
      }
    };

    void pullCandles(true);
    if (!isOnline) {
      return () => {
        cancelled = true;
      };
    }

    const refreshMs = isMt5Live ? 5_000 : 12_000;
    const timer = setInterval(() => {
      void pullCandles(false);
    }, refreshMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedSymbol, timeframe, isOnline, isMt5Live, selectedDataSource, brokerLastSyncedAt]);

  // Background-fetch 5m candles for all instruments to power Multi-Asset ORB Scanner & Notification Automation
  useEffect(() => {
    if (!isOnline || instruments.length === 0) return;
    let cancelled = false;
    const missing = instruments.filter((i) => !candlesBySymbolRef.current[i.symbol]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (inst) => {
        try {
          const res = await fetch(
            `/api/candles/${encodeURIComponent(inst.symbol)}?timeframe=5m`,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as {candles: Candle[]};
          return {symbol: inst.symbol, candles: data.candles};
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const patch: Record<string, Candle[]> = {};
      results.forEach((r) => {
        if (r && r.candles?.length) patch[r.symbol] = r.candles;
      });
      if (Object.keys(patch).length > 0) {
        setCandlesBySymbol((prev) => ({...prev, ...patch}));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOnline, instruments.length]);

  return {
    candles,
    setCandles,
    candlesBySymbol,
    setCandlesBySymbol,
    candlesRef,
    candlesBySymbolRef,
  };
}
