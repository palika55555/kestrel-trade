import type {
  BrokerProvider,
  BrokerStatus,
  Candle,
  EconomicCalendarSnapshot,
  EconomicEvent,
  Instrument,
  MarketPrint,
  OrderBookLevel,
  Position,
  ServerBotState,
  Timeframe,
  TradeExecution,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
  CotPositioning,
  GoldMarketRegime,
  InstitutionalGoldContext,
  OrderSide,
  XauBotStrategy,
} from '../src/types/trading.ts';
import type {InstrumentSeed} from './instruments.ts';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

export function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export const bratislavaDayFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Bratislava'});
// YYYY-MM-DD of a timestamp in Slovak time; the daily loss limit resets at local midnight.
export function bratislavaDay(ts: number): string {
  return bratislavaDayFormat.format(ts);
}

export function buildSyntheticOrderBook(
  bid: number,
  ask: number,
  tickSize: number,
  decimals: number,
): {bids: OrderBookLevel[]; asks: OrderBookLevel[]} {
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  let bidCum = 0;
  let askCum = 0;
  for (let i = 0; i < 8; i++) {
    const bSize = Math.round(14 + ((i * 19) % 55));
    const aSize = Math.round(14 + ((i * 23) % 55));
    bidCum += bSize;
    askCum += aSize;
    bids.push({
      price: roundToDecimals(bid - i * tickSize, decimals),
      size: bSize,
      total: bidCum,
    });
    asks.push({
      price: roundToDecimals(ask + i * tickSize, decimals),
      size: aSize,
      total: askCum,
    });
  }
  return {bids, asks};
}

export function generateFallbackCandles(
  seed: InstrumentSeed,
  timeframe: Timeframe,
  count: number,
  endPrice: number,
): Candle[] {
  const tfSec = TIMEFRAME_SECONDS[timeframe];
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucket = Math.floor(nowSec / tfSec) * tfSec;
  const candles: Candle[] = [];
  let p = endPrice;
  const closes = new Array<number>(count);
  closes[count - 1] = p;
  for (let i = count - 2; i >= 0; i--) {
    p = p / (1 + (Math.random() - 0.5) * 0.0012);
    closes[i] = p;
  }
  for (let i = 0; i < count; i++) {
    const c = roundToDecimals(closes[i], seed.decimals);
    const o = i === 0 ? c : candles[i - 1].close;
    const spread = Math.max(seed.tickSize * 2, Math.abs(c - o) * 1.4);
    candles.push({
      time: currentBucket - (count - 1 - i) * tfSec,
      open: o,
      high: roundToDecimals(Math.max(o, c) + spread * 0.5, seed.decimals),
      low: roundToDecimals(Math.min(o, c) - spread * 0.5, seed.decimals),
      close: c,
      volume: Math.round(120 + Math.random() * 480),
    });
  }
  return candles;
}

export async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}


export function aggregateCandles4H(hourly: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  const sec4h = 14400;
  for (const c of hourly) {
    const b = Math.floor(c.time / sec4h) * sec4h;
    const existing = buckets.get(b);
    if (!existing) {
      buckets.set(b, {...c, time: b});
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}


export function serverEmaLast(candles: Candle[], period: number): number {
  if (candles.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

export function serverEmaPrev(candles: Candle[], period: number): number {
  if (candles.length < 2) return serverEmaLast(candles, period);
  return serverEmaLast(candles.slice(0, -1), period);
}

export function serverRsiLast(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 75;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

export function serverVwapLast(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const recent = candles.slice(-40);
  let cumPV = 0;
  let cumV = 0;
  for (const c of recent) {
    const tp = (c.high + c.low + c.close) / 3;
    const vol = Math.max(1, c.volume);
    cumPV += tp * vol;
    cumV += vol;
  }
  return cumV > 0 ? cumPV / cumV : recent[recent.length - 1].close;
}

export function serverAtr14(candles: Candle[]): number {
  if (candles.length < 15) return 2.2;
  let sum = 0;
  const start = candles.length - 14;
  for (let i = start; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    sum += tr;
  }
  return roundToDecimals(sum / 14, 2);
}

export function serverBollingerLast(candles: Candle[], period = 20): {upper: number; lower: number; mid: number} {
  const slice = candles.slice(-period);
  if (slice.length === 0) return {upper: 0, lower: 0, mid: 0};
  const mean = slice.reduce((a, c) => a + c.close, 0) / slice.length;
  const variance = slice.reduce((a, c) => a + (c.close - mean) ** 2, 0) / slice.length;
  const std = Math.sqrt(variance);
  return {upper: mean + 2 * std, lower: mean - 2 * std, mid: mean};
}

export function serverDetectRegime(
  candles: Candle[],
  ema9: number,
  ema21: number,
  bbUpper: number,
  bbLower: number,
  rsi14: number,
  atr14: number,
): GoldMarketRegime {
  if (candles.length < 18) return 'RANGING';
  const slice = candles.slice(-15);
  const netMove = Math.abs(slice[slice.length - 1].close - slice[0].close);
  let pathSum = 0;
  for (let i = 1; i < slice.length; i++) {
    pathSum += Math.abs(slice[i].close - slice[i - 1].close);
  }
  const eff = pathSum > 0 ? netMove / pathSum : 0;
  const price = slice[slice.length - 1].close || 1;
  const bbWidthPct = ((bbUpper - bbLower) / price) * 100;
  const emaGap = Math.abs(ema9 - ema21);
  if ((rsi14 >= 70 || rsi14 <= 30) && bbWidthPct >= 0.45) return 'VOLATILE_REVERSAL';
  if (eff >= 0.42 && emaGap >= Math.max(0.4, atr14 * 0.28)) return 'TRENDING';
  if (bbWidthPct <= 0.32 || (eff >= 0.34 && netMove >= atr14 * 1.4)) return 'BREAKOUT';
  return 'RANGING';
}

export function serverAtasBarSignals(candles: Candle[]): {
  absorption: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'NONE';
  cvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
} {
  if (candles.length < 8) return {absorption: 'NONE', cvdDivergence: 'NONE'};
  const recent = candles.slice(-8);
  const avgVol = recent.reduce((a, b) => a + Math.max(1, b.volume), 0) / recent.length;
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const barRange = Math.max(0.05, last.high - last.low);
  const closePos = (last.close - last.low) / barRange;

  let absorption: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'NONE' = 'NONE';
  if (last.volume >= avgVol * 1.35) {
    if (closePos >= 0.65 && last.close <= prev.close) absorption = 'BULLISH_ABSORPTION';
    else if (closePos <= 0.35 && last.close >= prev.close) absorption = 'BEARISH_ABSORPTION';
  }

  let cvdFirst = 0;
  let cvdSecond = 0;
  recent.forEach((b, idx) => {
    const r = Math.max(0.05, b.high - b.low);
    const d = ((b.close - b.open) / r) * Math.max(1, b.volume);
    if (idx < 4) cvdFirst += d;
    else cvdSecond += d;
  });
  let cvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  if (last.close < recent[0].close && cvdSecond > cvdFirst + avgVol * 0.4) cvdDivergence = 'BULLISH';
  else if (last.close > recent[0].close && cvdSecond < cvdFirst - avgVol * 0.4) cvdDivergence = 'BEARISH';

  return {absorption, cvdDivergence};
}

export function serverInKillzone(nowMs: number): boolean {
  const d = new Date(nowMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (mins >= 420 && mins <= 660) || (mins >= 750 && mins <= 1050);
}

export function serverAdaptConfig(
  current: XauBotConfig,
  closedTrades: XauBotTradeRecord[],
): {nextConfig: XauBotConfig; summary: string | null} {
  if (closedTrades.length < 2) return {nextConfig: current, summary: null};
  const chronological = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);
  const recent = chronological.slice(-5);
  const recentWins = recent.filter((t) => t.netPnl > 0).length;
  const recentWr = (recentWins / recent.length) * 100;

  let trailingLosses = 0;
  let trailingWins = 0;
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (chronological[i].netPnl < 0 && trailingWins === 0) trailingLosses += 1;
    else if (chronological[i].netPnl > 0 && trailingLosses === 0) trailingWins += 1;
    else break;
  }

  const next: XauBotConfig = {...current};
  const changes: string[] = [];

  const strats: XauBotStrategy[] = [
    'SMART_ENSEMBLE',
    'ORB_VWAP',
    'LIQUIDITY_SWEEP_SMC',
    'ORDERFLOW_LIQUIDITY',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
  ];
  const byStrat = strats.map((s) => {
    const rows = chronological.filter((t) => t.strategy === s);
    const net = rows.reduce((a, r) => a + r.netPnl, 0);
    return {strategy: s, count: rows.length, net, avg: rows.length > 0 ? net / rows.length : 0};
  });
  const curStat = byStrat.find((x) => x.strategy === current.strategy);
  if (curStat && curStat.count >= 2 && (curStat.net < 0 || trailingLosses >= 2)) {
    const better = byStrat
      .filter((x) => x.strategy !== current.strategy && x.count >= 2 && x.avg > curStat.avg)
      .sort((a, b) => b.avg - a.avg)[0];
    const fallback = current.strategy !== 'SMART_ENSEMBLE' ? byStrat.find((x) => x.strategy === 'SMART_ENSEMBLE') : undefined;
    const candidate = better || fallback;
    if (candidate) {
      next.strategy = candidate.strategy;
      changes.push(`Strategy ${current.strategy}->${candidate.strategy}`);
    }
  }

  if ((recent.length >= 3 && recentWr < 45) || trailingLosses >= 2) {
    const raised = Math.min(85, current.minConfidence + 5);
    if (raised !== current.minConfidence) {
      next.minConfidence = raised;
      changes.push(`MinConf ${current.minConfidence}%->${raised}%`);
    }
  } else if (recent.length >= 4 && recentWr >= 70 && current.minConfidence > 50) {
    const eased = Math.max(50, current.minConfidence - 5);
    if (eased !== current.minConfidence) {
      next.minConfidence = eased;
      changes.push(`MinConf ${current.minConfidence}%->${eased}%`);
    }
  }

  const slHits = recent.filter((t) => t.exitAction === 'STOP_LOSS').length;
  const tpHits = recent.filter((t) => t.exitAction === 'TAKE_PROFIT').length;
  if (slHits >= 2 && slHits > tpHits) {
    const widerSl = Math.min(18, roundToDecimals(current.stopLossDollars + 1.5, 2));
    if (widerSl !== current.stopLossDollars) {
      next.stopLossDollars = widerSl;
      next.takeProfitDollars = Math.min(36, Math.max(current.takeProfitDollars, roundToDecimals(widerSl * 1.8, 2)));
      changes.push(`SL $${current.stopLossDollars}->$${widerSl}`);
    }
  } else if (tpHits >= 2 && recentWr >= 60) {
    const extTp = Math.min(32, roundToDecimals(current.takeProfitDollars + 2, 2));
    if (extTp !== current.takeProfitDollars) {
      next.takeProfitDollars = extTp;
      changes.push(`TP $${current.takeProfitDollars}->$${extTp}`);
    }
  }

  return {
    nextConfig: changes.length > 0 ? next : current,
    summary: changes.length > 0 ? changes.join(' · ') : null,
  };
}

// The bot refuses to open new trades when the last live quote is older than this.
export const MAX_QUOTE_AGE_MS = 30_000;

export function isQuoteStale(lastLiveAt: number, now: number, maxAgeMs = MAX_QUOTE_AGE_MS): boolean {
  return lastLiveAt <= 0 || now - lastLiveAt > maxAgeMs;
}
