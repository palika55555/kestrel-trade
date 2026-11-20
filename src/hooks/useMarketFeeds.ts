import {useEffect, useState, type Dispatch, type RefObject, type SetStateAction} from 'react';
import type {
  Candle,
  EconomicCalendarSnapshot,
  InstitutionalGoldContext,
  MacroGoldContext,
  MarketPrint,
  Timeframe,
  XauBotConfig,
} from '../types/trading';

/**
 * State for auxiliary market feeds: Time & Sales prints, XAU/USD multi-timeframe
 * candles, gold macro context and the economic calendar. Polling lives in the
 * separate hooks below so effect order matches the original App component.
 */
export function useMarketFeedState() {
  const [recentPrints, setRecentPrints] = useState<MarketPrint[]>([]);
  const [xauRecentPrints, setXauRecentPrints] = useState<MarketPrint[]>([]);
  const [xauMtfCandles, setXauMtfCandles] = useState<Partial<Record<Timeframe, Candle[]>>>({});
  const [goldMacro, setGoldMacro] = useState<MacroGoldContext | null>(null);
  const [institutionalGold, setInstitutionalGold] = useState<InstitutionalGoldContext | null>(null);
  const [calendarSnapshot, setCalendarSnapshot] = useState<EconomicCalendarSnapshot | null>(null);

  return {
    recentPrints,
    setRecentPrints,
    xauRecentPrints,
    setXauRecentPrints,
    xauMtfCandles,
    setXauMtfCandles,
    goldMacro,
    setGoldMacro,
    institutionalGold,
    setInstitutionalGold,
    calendarSnapshot,
    setCalendarSnapshot,
  };
}

export function useOrderFlowPolling(
  selectedSymbol: string,
  isOnline: boolean,
  xauBotConfigRef: RefObject<XauBotConfig>,
  setRecentPrints: Dispatch<SetStateAction<MarketPrint[]>>,
  setXauRecentPrints: Dispatch<SetStateAction<MarketPrint[]>>,
) {
  // Poll real live Time & Sales prints & liquidity feed for selected symbol (and XAU/USD for the bot)
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const fetchFlow = async () => {
      try {
        const res = await fetch(
          `/api/orderflow/${encodeURIComponent(selectedSymbol)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {recentPrints?: MarketPrint[]};
        if (!cancelled && Array.isArray(data.recentPrints)) {
          setRecentPrints(data.recentPrints);
          if (selectedSymbol === 'XAU/USD') {
            setXauRecentPrints(data.recentPrints);
          }
        }
        if (!cancelled && selectedSymbol !== 'XAU/USD' && xauBotConfigRef.current.enabled) {
          const xauRes = await fetch('/api/orderflow/XAU%2FUSD');
          if (xauRes.ok) {
            const xauData = (await xauRes.json()) as {recentPrints?: MarketPrint[]};
            if (!cancelled && Array.isArray(xauData.recentPrints)) {
              setXauRecentPrints(xauData.recentPrints);
            }
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };
    fetchFlow();
    const timer = setInterval(fetchFlow, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedSymbol, isOnline]);
}

export function useGoldContextPolling(
  isOnline: boolean,
  xauBotConfigRef: RefObject<XauBotConfig>,
  setXauMtfCandles: Dispatch<SetStateAction<Partial<Record<Timeframe, Candle[]>>>>,
  setGoldMacro: Dispatch<SetStateAction<MacroGoldContext | null>>,
  setInstitutionalGold: Dispatch<SetStateAction<InstitutionalGoldContext | null>>,
  setCalendarSnapshot: Dispatch<SetStateAction<EconomicCalendarSnapshot | null>>,
  brokerProvider?: string,
  brokerLastSyncedAt?: number | null,
) {
  // Poll Multi-Timeframe XAU/USD Candles (5m, 15m, 1H, 4H) and Macro Gold Context (DXY, US10Y, GC1! Basis)
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const fetchMtf = async () => {
      const tfs: Timeframe[] = ['5m', '15m', '1H', '4H'];
      const results = await Promise.all(
        tfs.map(async (tf) => {
          try {
            const r = await fetch(
              `/api/candles/${encodeURIComponent('XAU/USD')}?timeframe=${tf}`,
            );
            if (!r.ok) return null;
            const d = (await r.json()) as {candles?: Candle[]};
            return d.candles?.length ? ([tf, d.candles] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const patch: Partial<Record<Timeframe, Candle[]>> = {};
      for (const item of results) {
        if (item) patch[item[0]] = item[1];
      }
      if (Object.keys(patch).length > 0) {
        setXauMtfCandles((prev) => ({...prev, ...patch}));
      }
    };

    const fetchMacro = async () => {
      try {
        const res = await fetch('/api/macro/gold');
        if (!res.ok) return;
        const data = (await res.json()) as MacroGoldContext;
        if (!cancelled && typeof data.dxyPrice === 'number') {
          setGoldMacro(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    const fetchInstitutional = async () => {
      try {
        const res = await fetch('/api/institutional/gold');
        if (!res.ok) return;
        const data = (await res.json()) as InstitutionalGoldContext;
        if (!cancelled && typeof data.compositeScore === 'number') {
          setInstitutionalGold(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    const fetchCalendar = async () => {
      try {
        const before = xauBotConfigRef.current.newsPauseMinutesBefore ?? 15;
        const after = xauBotConfigRef.current.newsPauseMinutesAfter ?? 15;
        const res = await fetch(`/api/calendar?before=${before}&after=${after}`);
        if (!res.ok) return;
        const data = (await res.json()) as EconomicCalendarSnapshot;
        if (!cancelled && Array.isArray(data.events)) {
          setCalendarSnapshot(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    fetchMtf();
    fetchMacro();
    fetchInstitutional();
    fetchCalendar();
    const mtfIntervalMs = brokerProvider === 'MT5' ? 10_000 : 15_000;
    const mtfTimer = setInterval(fetchMtf, mtfIntervalMs);
    const macroTimer = setInterval(fetchMacro, 6_000);
    const instTimer = setInterval(fetchInstitutional, 6_000);
    const calTimer = setInterval(fetchCalendar, 60_000);

    return () => {
      cancelled = true;
      clearInterval(mtfTimer);
      clearInterval(macroTimer);
      clearInterval(instTimer);
      clearInterval(calTimer);
    };
  }, [isOnline, brokerProvider, brokerLastSyncedAt]);
}
