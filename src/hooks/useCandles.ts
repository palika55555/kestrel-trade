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
) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesBySymbol, setCandlesBySymbol] = useState<Record<string, Candle[]>>({});

  const candlesBySymbolRef = useLatestRef(candlesBySymbol);
  const candlesRef = useLatestRef(candles);

  // Fetch candles when symbol or timeframe changes (with IndexedDB offline fallback)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cached = await loadCachedCandles(selectedSymbol, timeframe);
      if (cached && cached.length > 0 && !cancelled) {
        setCandles(cached);
        setCandlesBySymbol((prev) => ({...prev, [selectedSymbol]: cached}));
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
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, timeframe, isOnline]);

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
