import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
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
} from './src/types/trading.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(
  process.env.PORT || (process.env.FLY_APP_NAME ? 8080 : 3000),
);
const distPath = path.resolve(__dirname, 'dist');
const hasBuiltDist = fs.existsSync(path.join(distPath, 'index.html'));
const useViteDev =
  process.env.NODE_ENV !== 'production' &&
  (!hasBuiltDist || process.env.npm_lifecycle_event === 'dev');

interface InstrumentSeed {
  symbol: string;
  name: string;
  assetClass: Instrument['assetClass'];
  contractType: Instrument['contractType'];
  exchange: string;
  contractSize: number;
  unitLabel: string;
  tickSize: number;
  tickValue: number;
  decimals: number;
  maxLeverage: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
  overnightSwapLong: number;
  overnightSwapShort: number;
  commissionPerUnit: number;
  expiryDate?: string;
  fallbackPrice: number;
  spreadTicks: number;
  yahooSymbol?: string;
  swissquotePair?: string;
  krakenPair?: string;
  dataSourceLabel: string;
}

const SEEDS: InstrumentSeed[] = [
  {
    symbol: 'ES1!',
    name: 'E-Mini S&P 500 Futures',
    assetClass: 'FUTURES',
    contractType: 'FUTURE',
    exchange: 'CME',
    contractSize: 50,
    unitLabel: 'contracts',
    tickSize: 0.25,
    tickValue: 12.5,
    decimals: 2,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.035,
    overnightSwapLong: 0,
    overnightSwapShort: 0,
    commissionPerUnit: 2.25,
    expiryDate: '2026-12-18',
    fallbackPrice: 7418.0,
    spreadTicks: 1,
    yahooSymbol: 'ES=F',
    dataSourceLabel: 'Yahoo Finance · CME',
  },
  {
    symbol: 'NQ1!',
    name: 'E-Mini Nasdaq-100 Futures',
    assetClass: 'FUTURES',
    contractType: 'FUTURE',
    exchange: 'CME',
    contractSize: 20,
    unitLabel: 'contracts',
    tickSize: 0.25,
    tickValue: 5.0,
    decimals: 2,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.035,
    overnightSwapLong: 0,
    overnightSwapShort: 0,
    commissionPerUnit: 2.25,
    expiryDate: '2026-12-18',
    fallbackPrice: 25680.0,
    spreadTicks: 2,
    yahooSymbol: 'NQ=F',
    dataSourceLabel: 'Yahoo Finance · CME',
  },
  {
    symbol: 'CL1!',
    name: 'WTI Crude Oil Futures',
    assetClass: 'COMMODITY_FUTURES',
    contractType: 'FUTURE',
    exchange: 'NYMEX',
    contractSize: 1000,
    unitLabel: 'contracts',
    tickSize: 0.01,
    tickValue: 10.0,
    decimals: 2,
    maxLeverage: 15,
    initialMarginRate: 0.066,
    maintenanceMarginRate: 0.045,
    overnightSwapLong: 0,
    overnightSwapShort: 0,
    commissionPerUnit: 2.5,
    expiryDate: '2026-12-21',
    fallbackPrice: 71.5,
    spreadTicks: 2,
    yahooSymbol: 'CL=F',
    dataSourceLabel: 'Yahoo Finance · NYMEX',
  },
  {
    symbol: 'GC1!',
    name: 'Gold COMEX Futures',
    assetClass: 'COMMODITY_FUTURES',
    contractType: 'FUTURE',
    exchange: 'COMEX',
    contractSize: 100,
    unitLabel: 'contracts',
    tickSize: 0.1,
    tickValue: 10.0,
    decimals: 2,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.035,
    overnightSwapLong: 0,
    overnightSwapShort: 0,
    commissionPerUnit: 2.4,
    expiryDate: '2026-12-29',
    fallbackPrice: 3872.1,
    spreadTicks: 2,
    yahooSymbol: 'GC=F',
    dataSourceLabel: 'Yahoo Finance · COMEX',
  },
  {
    symbol: 'XAU/USD',
    name: 'Spot Gold / US Dollar CFD',
    assetClass: 'COMMODITY_FUTURES',
    contractType: 'CFD',
    exchange: 'OTC SPOT',
    contractSize: 100,
    unitLabel: 'lots',
    tickSize: 0.01,
    tickValue: 1.0,
    decimals: 2,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.025,
    overnightSwapLong: -11.4,
    overnightSwapShort: 3.2,
    commissionPerUnit: 0.0,
    fallbackPrice: 3868.3,
    spreadTicks: 35,
    swissquotePair: 'XAU/USD',
    yahooSymbol: 'GC=F', // Historical candle structure synced to Gold
    dataSourceLabel: 'Swissquote Live BBO',
  },
  {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar CFD',
    assetClass: 'FX_CFD',
    contractType: 'CFD',
    exchange: 'OTC FX',
    contractSize: 100000,
    unitLabel: 'lots',
    tickSize: 0.0001,
    tickValue: 10.0,
    decimals: 5,
    maxLeverage: 30,
    initialMarginRate: 0.0333,
    maintenanceMarginRate: 0.0167,
    overnightSwapLong: -4.2,
    overnightSwapShort: 1.8,
    commissionPerUnit: 3.5,
    fallbackPrice: 1.1,
    spreadTicks: 0.8,
    swissquotePair: 'EUR/USD',
    yahooSymbol: 'EURUSD=X',
    dataSourceLabel: 'Swissquote Live BBO',
  },
  {
    symbol: 'GBP/JPY',
    name: 'British Pound / Japanese Yen CFD',
    assetClass: 'FX_CFD',
    contractType: 'CFD',
    exchange: 'OTC FX',
    contractSize: 100000,
    unitLabel: 'lots',
    tickSize: 0.01,
    tickValue: 6.55,
    decimals: 3,
    maxLeverage: 30,
    initialMarginRate: 0.0333,
    maintenanceMarginRate: 0.0167,
    overnightSwapLong: 5.4,
    overnightSwapShort: -8.9,
    commissionPerUnit: 3.5,
    fallbackPrice: 209.74,
    spreadTicks: 1.5,
    swissquotePair: 'GBP/JPY',
    yahooSymbol: 'GBPJPY=X',
    dataSourceLabel: 'Swissquote Live BBO',
  },
  {
    symbol: 'US30',
    name: 'Wall Street 30 Index CFD',
    assetClass: 'INDEX_CFD',
    contractType: 'CFD',
    exchange: 'CBOT / CFD',
    contractSize: 1,
    unitLabel: 'contracts',
    tickSize: 1,
    tickValue: 1,
    decimals: 1,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.025,
    overnightSwapLong: -6.1,
    overnightSwapShort: 1.4,
    commissionPerUnit: 0.5,
    fallbackPrice: 48200.0,
    spreadTicks: 2,
    yahooSymbol: 'YM=F',
    dataSourceLabel: 'Yahoo Finance · CBOT',
  },
  {
    symbol: 'BTC/USD',
    name: 'Bitcoin Spot CFD',
    assetClass: 'CRYPTO_CFD',
    contractType: 'CFD',
    exchange: 'KRAKEN SPOT',
    contractSize: 1,
    unitLabel: 'coins',
    tickSize: 0.1,
    tickValue: 0.1,
    decimals: 2,
    maxLeverage: 10,
    initialMarginRate: 0.1,
    maintenanceMarginRate: 0.05,
    overnightSwapLong: -18.5,
    overnightSwapShort: -12.0,
    commissionPerUnit: 12.0,
    fallbackPrice: 64266.0,
    spreadTicks: 12,
    krakenPair: 'XBTUSD',
    dataSourceLabel: 'Kraken Live Spot',
  },
];

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

const bratislavaDayFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Bratislava'});
// YYYY-MM-DD of a timestamp in Slovak time; the daily loss limit resets at local midnight.
function bratislavaDay(ts: number): string {
  return bratislavaDayFormat.format(ts);
}

function buildSyntheticOrderBook(
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

function generateFallbackCandles(
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

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T | null> {
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

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface SwissquoteQuote {
  spreadProfilePrices?: Array<{
    spreadProfile: string;
    bid: number;
    ask: number;
  }>;
}

interface KrakenTickerResponse {
  error?: string[];
  result?: Record<
    string,
    {
      a: [string, string, string];
      b: [string, string, string];
      c: [string, string];
      v: [string, string];
      h: [string, string];
      l: [string, string];
      o: string;
    }
  >;
}

interface KrakenOHLCResponse {
  error?: string[];
  result?: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
}

interface KrakenDepthResponse {
  error?: string[];
  result?: Record<
    string,
    {
      asks: Array<[string, string, number]>;
      bids: Array<[string, string, number]>;
    }
  >;
}

interface KrakenTradesResponse {
  error?: string[];
  result?: Record<
    string,
    Array<[string, string, number, 'b' | 's', 'm' | 'l', string]>
  >;
}

interface SpreadTier {
  profile: string;
  bid: number;
  ask: number;
}

function aggregateCandles4H(hourly: Candle[]): Candle[] {
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

interface ForexFactoryRawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

const SERVER_BOOT_ID = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const HAS_PERSISTENT_VOLUME = Boolean(
  (process.env.KESTREL_DATA_DIR && fs.existsSync(process.env.KESTREL_DATA_DIR)) ||
    fs.existsSync('/data'),
);
const SERVER_DATA_DIR =
  process.env.KESTREL_DATA_DIR && fs.existsSync(process.env.KESTREL_DATA_DIR)
    ? process.env.KESTREL_DATA_DIR
    : fs.existsSync('/data')
    ? '/data'
    : process.cwd();
const SERVER_BOT_STATE_PATH = path.join(SERVER_DATA_DIR, '.kestrel-server-bot.json');

function createServerBotDefaultConfig(): XauBotConfig {
  return {
    enabled: false,
    autoLearnEnabled: true,
    useOrderFlowConfluence: true,
    useMtfConfluence: true,
    useMacroConfluence: true,
    useSessionSpreadGuard: true,
    useNewsGuard: true,
    newsPauseMinutesBefore: 15,
    newsPauseMinutesAfter: 15,
    maxSpreadDollars: 1.2,
    autoBreakEvenEnabled: true,
    partialTpEnabled: true,
    strategy: 'ORB_VWAP',
    lotSize: 0.1,
    leverage: 15,
    stopLossDollars: 8.0,
    takeProfitDollars: 16.0,
    trailingStopDollars: null,
    maxConcurrentPositions: 3,
    cooldownSeconds: 25,
    maxDailyLossDollars: 1200,
    minConfidence: 55,
  };
}

function serverEmaLast(candles: Candle[], period: number): number {
  if (candles.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

function serverRsiLast(candles: Candle[], period = 14): number {
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

class LiveMarketEngine {
  private instruments = new Map<string, Instrument>();
  private seeds = new Map<string, InstrumentSeed>();
  private candleCache = new Map<string, Map<Timeframe, Candle[]>>();
  private candleFetchedAt = new Map<string, number>();
  private recentPrints = new Map<string, MarketPrint[]>();
  private spreadTiers = new Map<string, SpreadTier[]>();
  private subscribers = new Set<express.Response>();
  private calendarEvents: EconomicEvent[] = [];
  private calendarUpdatedAt = 0;
  private macroGold = {
    dxyPrice: 106.4,
    dxyChangePct: 0,
    us10yYield: 4.42,
    us10yChangePct: 0,
    updatedAt: 0,
    live: false,
  };
  private serverBot: ServerBotState = {
    enabled: false,
    config: createServerBotDefaultConfig(),
    positions: [],
    closedTrades: [],
    executions: [],
    logs: [],
    netPnl: 0,
    lastEvaluatedAt: 0,
    brokerRoutingArmed: false,
  };
  private serverBotLastTradeAt = 0;
  private serverBotLastHoldLogAt = 0;
  private brokerOrderInFlight = false;
  private swissquoteInFlight = false;
  private yahooInFlight = false;
  private brokerCache: {
    balance: number | null;
    equity: number | null;
    unrealizedPnl: number | null;
    marginUsed: number | null;
    openPositionsCount: number;
    currency: string;
    accountLabel: string;
    lastSyncedAt: number | null;
    lastOrderSummary: string | null;
    lastError: string | null;
  } = {
    balance: null,
    equity: null,
    unrealizedPnl: null,
    marginUsed: null,
    openPositionsCount: 0,
    currency: 'USD',
    accountLabel: 'Paper Simulation Ledger',
    lastSyncedAt: null,
    lastOrderSummary: null,
    lastError: null,
  };

  constructor() {
    for (const seed of SEEDS) {
      this.seeds.set(seed.symbol, seed);
      const halfSpread = (seed.spreadTicks * seed.tickSize) / 2;
      const bid = roundToDecimals(seed.fallbackPrice - halfSpread, seed.decimals);
      const ask = roundToDecimals(seed.fallbackPrice + halfSpread, seed.decimals);
      const book = buildSyntheticOrderBook(bid, ask, seed.tickSize, seed.decimals);

      const tfMap = new Map<Timeframe, Candle[]>();
      const initial15m = generateFallbackCandles(seed, '15m', 120, seed.fallbackPrice);
      tfMap.set('15m', initial15m);
      this.candleCache.set(seed.symbol, tfMap);

      this.instruments.set(seed.symbol, {
        symbol: seed.symbol,
        name: seed.name,
        assetClass: seed.assetClass,
        contractType: seed.contractType,
        exchange: seed.exchange,
        contractSize: seed.contractSize,
        unitLabel: seed.unitLabel,
        tickSize: seed.tickSize,
        tickValue: seed.tickValue,
        decimals: seed.decimals,
        maxLeverage: seed.maxLeverage,
        initialMarginRate: seed.initialMarginRate,
        maintenanceMarginRate: seed.maintenanceMarginRate,
        overnightSwapLong: seed.overnightSwapLong,
        overnightSwapShort: seed.overnightSwapShort,
        commissionPerUnit: seed.commissionPerUnit,
        expiryDate: seed.expiryDate,
        price: seed.fallbackPrice,
        bid,
        ask,
        open24h: seed.fallbackPrice,
        high24h: seed.fallbackPrice,
        low24h: seed.fallbackPrice,
        volume24h: 0,
        changePct: 0,
        sparkline: initial15m.slice(-24).map((c) => c.close),
        bids: book.bids,
        asks: book.asks,
        dataSource: seed.dataSourceLabel,
        feedStatus: 'FALLBACK',
      });
    }

    this.loadServerBotState();

    // Immediate initial live pull, then scheduled live polling
    this.pollSwissquoteAndKraken();
    this.pollYahooQuotes();
    this.preloadInitialCandles();
    this.fetchEconomicCalendar();

    setInterval(() => this.pollSwissquoteAndKraken(), 2000);
    setInterval(() => this.pollYahooQuotes(), 4000);
    setInterval(() => this.fetchEconomicCalendar(), 15 * 60_000);
  }

  private loadServerBotState() {
    try {
      if (fs.existsSync(SERVER_BOT_STATE_PATH)) {
        const raw = fs.readFileSync(SERVER_BOT_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ServerBotState>;
        this.serverBot = {
          enabled: Boolean(parsed.enabled),
          config: {...createServerBotDefaultConfig(), ...(parsed.config || {})},
          positions: Array.isArray(parsed.positions) ? parsed.positions : [],
          closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
          executions: Array.isArray(parsed.executions) ? parsed.executions : [],
          logs: Array.isArray(parsed.logs) ? parsed.logs : [],
          netPnl: typeof parsed.netPnl === 'number' ? parsed.netPnl : 0,
          lastEvaluatedAt: parsed.lastEvaluatedAt || 0,
          brokerRoutingArmed: Boolean(parsed.brokerRoutingArmed),
          archivedRealizedPnl: typeof parsed.archivedRealizedPnl === 'number' ? parsed.archivedRealizedPnl : 0,
          dailyLossPausedDay: parsed.dailyLossPausedDay,
        };
      }
    } catch {
      // Ignore corrupt persisted bot file
    }
  }

  // Keeps the last 200 trades; P&L of trades that fall off is kept in archivedRealizedPnl so the all-time total stays correct.
  private capClosedTrades(trades: XauBotTradeRecord[]): XauBotTradeRecord[] {
    const dropped = trades.slice(200).reduce((a, t) => a + t.netPnl, 0);
    if (dropped !== 0) {
      this.serverBot.archivedRealizedPnl = roundToDecimals((this.serverBot.archivedRealizedPnl || 0) + dropped, 2);
    }
    return trades.slice(0, 200);
  }

  // Returns { total: all-time realized + unrealized, daily: today's realized + unrealized }; the day is Europe/Bratislava.
  private computeServerBotPnl(xau: Instrument | undefined) {
    const today = bratislavaDay(Date.now());
    let realizedAll = this.serverBot.archivedRealizedPnl || 0;
    let realizedToday = 0;
    for (const t of this.serverBot.closedTrades) {
      realizedAll += t.netPnl;
      if (bratislavaDay(t.closedAt) === today) realizedToday += t.netPnl;
    }
    const unreal = xau
      ? this.serverBot.positions.reduce((a, p) => {
          const m = p.side === 'BUY' ? xau.bid : xau.ask;
          const d = p.side === 'BUY' ? m - p.entryPrice : p.entryPrice - m;
          return a + d * p.quantity * xau.contractSize;
        }, 0)
      : 0;
    return {
      total: roundToDecimals(realizedAll + unreal, 2),
      daily: roundToDecimals(realizedToday + unreal, 2),
    };
  }

  private persistServerBotState() {
    try {
      fs.writeFileSync(
        SERVER_BOT_STATE_PATH,
        JSON.stringify(this.serverBot),
        'utf8',
      );
    } catch {
      // Ignore fs write issues in read-only environments
    }
  }

  private appendServerBotLog(level: XauBotLogEntry['level'], message: string) {
    const entry: XauBotLogEntry = {
      id: `sbl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      level,
      message: `[24/7 Server] ${message}`,
    };
    this.serverBot.logs = [entry, ...this.serverBot.logs].slice(0, 80);
  }

  async fetchEconomicCalendar() {
    const rows = await fetchJsonWithTimeout<ForexFactoryRawEvent[]>(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      5500,
    );
    if (!Array.isArray(rows) || rows.length === 0) return;

    const events: EconomicEvent[] = [];
    rows.forEach((r, idx) => {
      if (!r.title || !r.date) return;
      const ts = Date.parse(r.date);
      if (!Number.isFinite(ts)) return;
      const impRaw = (r.impact || 'Low').trim();
      const impact: EconomicEvent['impact'] =
        impRaw === 'High' || impRaw === 'Medium' || impRaw === 'Low' || impRaw === 'Holiday'
          ? impRaw
          : 'Low';
      events.push({
        id: `ev-${ts}-${idx}`,
        title: r.title.trim(),
        country: (r.country || 'USD').trim().toUpperCase(),
        date: r.date,
        timestamp: ts,
        impact,
        forecast: (r.forecast || '').trim(),
        previous: (r.previous || '').trim(),
      });
    });

    if (events.length > 0) {
      this.calendarEvents = events.sort((a, b) => a.timestamp - b.timestamp);
      this.calendarUpdatedAt = Date.now();
    }
  }

  getEconomicCalendar(
    pauseBeforeMin = 15,
    pauseAfterMin = 15,
  ): EconomicCalendarSnapshot {
    const now = Date.now();
    const highUsd = this.calendarEvents.filter(
      (ev) => ev.impact === 'High' && (ev.country === 'USD' || ev.country === 'EUR'),
    );
    const activeGuardEvent =
      highUsd.find((ev) => {
        const diffMin = (ev.timestamp - now) / 60_000;
        return diffMin <= pauseBeforeMin && diffMin >= -pauseAfterMin;
      }) || null;

    const usdUpcoming = this.calendarEvents.filter(
      (ev) =>
        ev.impact === 'High' &&
        ev.country === 'USD' &&
        ev.timestamp >= now - pauseAfterMin * 60_000,
    );
    const nextHighImpactUsd = usdUpcoming[0] || null;
    const minutesToNextHighUsd = nextHighImpactUsd
      ? Math.round((nextHighImpactUsd.timestamp - now) / 60_000)
      : null;

    return {
      events: this.calendarEvents,
      nextHighImpactUsd,
      activeGuardEvent,
      minutesToNextHighUsd,
      newsGuardActive: Boolean(activeGuardEvent),
      source: 'ForexFactory Live Calendar',
      updatedAt: this.calendarUpdatedAt || now,
    };
  }

  private async preloadInitialCandles() {
    await Promise.all(
      SEEDS.map((s) => this.fetchLiveCandles(s.symbol, '15m').catch(() => {})),
    );
    await Promise.all(
      SEEDS.map((s) => this.fetchLiveCandles(s.symbol, '5m').catch(() => {})),
    );
    await this.fetchLiveCandles('XAU/USD', '1H').catch(() => {});
  }

  private applyQuoteUpdate(
    symbol: string,
    opts: {
      price: number;
      bid?: number;
      ask?: number;
      open24h?: number;
      high24h?: number;
      low24h?: number;
      volume24h?: number;
      bids?: OrderBookLevel[];
      asks?: OrderBookLevel[];
      feedStatus: 'LIVE' | 'FALLBACK';
    },
  ) {
    const inst = this.instruments.get(symbol);
    const seed = this.seeds.get(symbol);
    if (!inst || !seed || !Number.isFinite(opts.price) || opts.price <= 0) return;

    const price = roundToDecimals(opts.price, seed.decimals);
    const halfSpread = (seed.spreadTicks * seed.tickSize) / 2;
    const bid = roundToDecimals(opts.bid ?? price - halfSpread, seed.decimals);
    const ask = roundToDecimals(opts.ask ?? price + halfSpread, seed.decimals);

    // Record real BBO tick transition for live tape on non-Kraken instruments
    if (!seed.krakenPair && opts.feedStatus === 'LIVE') {
      const prevPrice = inst.price;
      const prevBid = inst.bid;
      const prevAsk = inst.ask;
      if (price !== prevPrice || bid !== prevBid || ask !== prevAsk) {
        const isBuyTick = price > prevPrice || (price === prevPrice && ask > prevAsk);
        const tickPrint: MarketPrint = {
          id: `bbo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          price: isBuyTick ? ask : bid,
          size: seed.contractType === 'FUTURE' ? 1 : 0.1,
          side: isBuyTick ? 'BUY' : 'SELL',
          timestamp: Date.now(),
          source: 'BBO_TICK',
        };
        const existingPrints = this.recentPrints.get(symbol) || [];
        this.recentPrints.set(symbol, [tickPrint, ...existingPrints].slice(0, 40));
      }
    }

    const open24h = opts.open24h && opts.open24h > 0 ? opts.open24h : inst.open24h;
    inst.price = price;
    inst.bid = bid;
    inst.ask = ask;
    inst.open24h = roundToDecimals(open24h, seed.decimals);
    inst.high24h = roundToDecimals(
      opts.high24h && opts.high24h > 0 ? opts.high24h : Math.max(inst.high24h, price),
      seed.decimals,
    );
    inst.low24h = roundToDecimals(
      opts.low24h && opts.low24h > 0 ? opts.low24h : Math.min(inst.low24h, price),
      seed.decimals,
    );
    if (opts.volume24h !== undefined && opts.volume24h > 0) {
      inst.volume24h = Math.round(opts.volume24h);
    }
    inst.changePct =
      open24h > 0 ? roundToDecimals(((price - open24h) / open24h) * 100, 2) : 0;
    inst.feedStatus = opts.feedStatus;

    if (opts.bids && opts.asks) {
      inst.bids = opts.bids;
      inst.asks = opts.asks;
    } else {
      const book = buildSyntheticOrderBook(bid, ask, seed.tickSize, seed.decimals);
      inst.bids = book.bids;
      inst.asks = book.asks;
    }

    // Update active candles with latest live price
    const nowSec = Math.floor(Date.now() / 1000);
    const tfMap = this.candleCache.get(symbol);
    if (tfMap) {
      for (const [tf, candles] of tfMap.entries()) {
        if (candles.length === 0) continue;
        const tfSec = TIMEFRAME_SECONDS[tf];
        const bucket = Math.floor(nowSec / tfSec) * tfSec;
        const last = candles[candles.length - 1];
        if (last.time === bucket) {
          last.close = price;
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
        } else if (bucket > last.time) {
          candles.push({
            time: bucket,
            open: last.close,
            high: price,
            low: price,
            close: price,
            volume: Math.max(1, Math.round(last.volume * 0.15)),
          });
          if (candles.length > 280) candles.shift();
        }
      }
      const c15 = tfMap.get('15m');
      if (c15 && c15.length >= 2) {
        inst.sparkline = c15.slice(-24).map((c) => c.close);
      }
    }
  }

  private broadcastTick() {
    if (this.subscribers.size === 0) return;
    const payload = JSON.stringify({
      type: 'TICK',
      timestamp: Date.now(),
      instruments: Array.from(this.instruments.values()),
    });
    for (const res of this.subscribers) {
      if (res.writableEnded || res.destroyed) {
        this.subscribers.delete(res);
        continue;
      }
      try {
        res.write(`data: ${payload}\n\n`);
      } catch {
        this.subscribers.delete(res);
      }
    }
  }

  private async pollSwissquoteAndKraken() {
    if (this.swissquoteInFlight) return;
    this.swissquoteInFlight = true;
    try {
      const swissSeeds = SEEDS.filter((s) => s.swissquotePair);
    await Promise.all([
      ...swissSeeds.map(async (seed) => {
        const data = await fetchJsonWithTimeout<SwissquoteQuote[]>(
          `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${seed.swissquotePair}`,
          3500,
        );
        const prices = data?.[0]?.spreadProfilePrices;
        if (!prices || prices.length === 0) return;
        const profile =
          prices.find((p) => p.spreadProfile === 'prime') || prices[0];
        this.spreadTiers.set(
          seed.symbol,
          prices
            .filter((p) => p.bid > 0 && p.ask > 0)
            .map((p) => ({
              profile: p.spreadProfile,
              bid: p.bid,
              ask: p.ask,
            })),
        );
        if (profile && profile.bid > 0 && profile.ask > 0) {
          const mid = (profile.bid + profile.ask) / 2;
          this.applyQuoteUpdate(seed.symbol, {
            price: mid,
            bid: profile.bid,
            ask: profile.ask,
            feedStatus: 'LIVE',
          });
        }
      }),
      (async () => {
        const krakenSeed = SEEDS.find((s) => s.krakenPair);
        if (!krakenSeed) return;
        const [tickerData, depthData, tradesData] = await Promise.all([
          fetchJsonWithTimeout<KrakenTickerResponse>(
            `https://api.kraken.com/0/public/Ticker?pair=${krakenSeed.krakenPair}`,
            3500,
          ),
          fetchJsonWithTimeout<KrakenDepthResponse>(
            `https://api.kraken.com/0/public/Depth?pair=${krakenSeed.krakenPair}&count=15`,
            3500,
          ),
          fetchJsonWithTimeout<KrakenTradesResponse>(
            `https://api.kraken.com/0/public/Trades?pair=${krakenSeed.krakenPair}`,
            3500,
          ),
        ]);

        const tKey = tickerData?.result ? Object.keys(tickerData.result)[0] : undefined;
        const t = tKey ? tickerData?.result?.[tKey] : undefined;
        if (!t) return;

        const ask = parseFloat(t.a[0]);
        const bid = parseFloat(t.b[0]);
        const last = parseFloat(t.c[0]);
        const open = parseFloat(t.o);
        const high = parseFloat(t.h[1]);
        const low = parseFloat(t.l[1]);
        const vol = parseFloat(t.v[1]);

        let bids: OrderBookLevel[] | undefined;
        let asks: OrderBookLevel[] | undefined;
        const dKey = depthData?.result ? Object.keys(depthData.result)[0] : undefined;
        const d = dKey ? depthData?.result?.[dKey] : undefined;
        if (d) {
          let bCum = 0;
          let aCum = 0;
          bids = d.bids.slice(0, 12).map(([p, sz]) => {
            const size = Number(parseFloat(sz).toFixed(3));
            bCum = Number((bCum + size).toFixed(3));
            return {price: parseFloat(p), size, total: bCum};
          });
          asks = d.asks.slice(0, 12).map(([p, sz]) => {
            const size = Number(parseFloat(sz).toFixed(3));
            aCum = Number((aCum + size).toFixed(3));
            return {price: parseFloat(p), size, total: aCum};
          });
        }

        const trKey = tradesData?.result
          ? Object.keys(tradesData.result).find((k) => k !== 'last')
          : undefined;
        const trRows = trKey ? tradesData?.result?.[trKey] : undefined;
        if (trRows && trRows.length > 0) {
          const prints: MarketPrint[] = trRows
            .slice(-40)
            .reverse()
            .map((row, idx) => ({
              id: `krk-${Math.round(row[2] * 1000)}-${idx}`,
              price: roundToDecimals(parseFloat(row[0]), krakenSeed.decimals),
              size: Number(parseFloat(row[1]).toFixed(4)),
              side: row[3] === 'b' ? 'BUY' : 'SELL',
              timestamp: Math.round(row[2] * 1000),
              source: 'KRAKEN_TRADE',
            }));
          this.recentPrints.set(krakenSeed.symbol, prints);
        }

        this.applyQuoteUpdate(krakenSeed.symbol, {
          price: last,
          bid,
          ask,
          open24h: open,
          high24h: high,
          low24h: low,
          volume24h: vol,
          bids,
          asks,
          feedStatus: 'LIVE',
        });
      })(),
    ]);

    try {
      this.evaluateServerBotTick();
    } catch (err) {
      console.error('[bot] evaluateServerBotTick error:', err);
    }
    this.broadcastTick();
    } catch (err) {
      console.error('[feed] pollSwissquoteAndKraken error:', err);
    } finally {
      this.swissquoteInFlight = false;
    }
  }

  private evaluateServerBotTick() {
    // A pause caused by the daily loss limit ends at the next Slovak midnight.
    const pausedDay = this.serverBot.dailyLossPausedDay;
    if (!this.serverBot.enabled && pausedDay && pausedDay !== bratislavaDay(Date.now())) {
      this.serverBot.enabled = true;
      this.serverBot.config.enabled = true;
      this.serverBot.dailyLossPausedDay = undefined;
      this.appendServerBotLog('INFO', 'New trading day: daily loss reset to $0, bot resumed.');
      this.persistServerBotState();
    }
    if (!this.serverBot.enabled) return;
    const xau = this.instruments.get('XAU/USD');
    if (!xau || xau.price <= 0) return;
    const now = Date.now();
    if (now - this.serverBot.lastEvaluatedAt < 1800) return;
    this.serverBot.lastEvaluatedAt = now;

    const cfg = this.serverBot.config;
    const remaining: Position[] = [];
    let stateDirty = false;

    // 1. Manage open 24/7 Server Bot positions (Trailing Stop, Auto BE, Partial TP, SL/TP)
    for (const pos of this.serverBot.positions) {
      const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
      let cur = {...pos};

      if (cur.trailingStopDistance && cur.trailingStopDistance > 0) {
        if (cur.side === 'BUY' && exitMark > cur.peakFavorablePrice) {
          const sl = roundToDecimals(exitMark - cur.trailingStopDistance, 2);
          cur.peakFavorablePrice = exitMark;
          cur.stopLoss = cur.stopLoss ? Math.max(cur.stopLoss, sl) : sl;
          stateDirty = true;
        } else if (cur.side === 'SELL' && exitMark < cur.peakFavorablePrice) {
          const sl = roundToDecimals(exitMark + cur.trailingStopDistance, 2);
          cur.peakFavorablePrice = exitMark;
          cur.stopLoss = cur.stopLoss ? Math.min(cur.stopLoss, sl) : sl;
          stateDirty = true;
        }
      }

      if (cur.takeProfit !== null) {
        const tpDist = Math.abs(cur.takeProfit - cur.entryPrice);
        const fav = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;

        if ((cfg.autoBreakEvenEnabled ?? true) && !cur.breakEvenMoved && tpDist > 0 && fav >= tpDist * 0.5) {
          const be = roundToDecimals(cur.side === 'BUY' ? cur.entryPrice + 0.35 : cur.entryPrice - 0.35, 2);
          cur.stopLoss =
            cur.side === 'BUY'
              ? cur.stopLoss !== null ? Math.max(cur.stopLoss, be) : be
              : cur.stopLoss !== null ? Math.min(cur.stopLoss, be) : be;
          cur.breakEvenMoved = true;
          stateDirty = true;
          void this.routeBrokerModifyRisk(cur, cur.stopLoss, cur.takeProfit);
          this.appendServerBotLog('RISK', `Auto BE locked SL @ ${cur.stopLoss.toFixed(2)}`);
        }

        if ((cfg.partialTpEnabled ?? true) && !cur.partialTpTaken && cur.quantity >= 0.04 && tpDist > 0 && fav >= tpDist * 0.7) {
          const closeQty = roundToDecimals(cur.quantity * 0.5, 2);
          const remQty = roundToDecimals(cur.quantity - closeQty, 2);
          if (closeQty > 0 && remQty > 0) {
            const diff = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;
            const gross = roundToDecimals(diff * closeQty * xau.contractSize, 2);
            const fee = roundToDecimals(closeQty * xau.commissionPerUnit * 2, 2);
            const net = roundToDecimals(gross - fee, 2);
            this.serverBot.closedTrades = this.capClosedTrades([
              {
                id: `sbtr-${now}-p`,
                positionId: `${cur.id}-ptp`,
                symbol: 'XAU/USD',
                side: cur.side,
                strategy: cur.botStrategy || cfg.strategy,
                quantity: closeQty,
                entryPrice: cur.entryPrice,
                exitPrice: exitMark,
                grossPnl: gross,
                fee,
                netPnl: net,
                exitAction: 'PARTIAL_CLOSE' as const,
                confidenceAtEntry: cur.botConfidence ?? 70,
                stopLossDollars: cfg.stopLossDollars,
                takeProfitDollars: cfg.takeProfitDollars,
                openedAt: cur.openedAt,
                closedAt: now,
              },
              ...this.serverBot.closedTrades,
            ]);
            cur.quantity = remQty;
            cur.partialTpTaken = true;
            cur.breakEvenMoved = true;
            stateDirty = true;
            void this.routeBrokerCloseOrder(pos, 0.5);
            this.appendServerBotLog('EXECUTION', `Partial TP 50% (${closeQty} lots) -> +$${net.toFixed(2)}`);
          }
        }
      }

      let hitAction: TradeExecution['action'] | null = null;
      if (cur.stopLoss !== null) {
        if ((cur.side === 'BUY' && exitMark <= cur.stopLoss) || (cur.side === 'SELL' && exitMark >= cur.stopLoss)) {
          hitAction = cur.trailingStopDistance ? 'TRAILING_STOP' : 'STOP_LOSS';
        }
      }
      if (!hitAction && cur.takeProfit !== null) {
        if ((cur.side === 'BUY' && exitMark >= cur.takeProfit) || (cur.side === 'SELL' && exitMark <= cur.takeProfit)) {
          hitAction = 'TAKE_PROFIT';
        }
      }

      if (hitAction) {
        void this.routeBrokerCloseOrder(cur, 1);
        const diff = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;
        const gross = roundToDecimals(diff * cur.quantity * xau.contractSize, 2);
        const fee = roundToDecimals(cur.quantity * xau.commissionPerUnit * 2, 2);
        const net = roundToDecimals(gross - fee, 2);
        this.serverBot.closedTrades = this.capClosedTrades([
          {
            id: `sbtr-${now}-${Math.random().toString(36).slice(2, 5)}`,
            positionId: cur.id,
            symbol: 'XAU/USD',
            side: cur.side,
            strategy: cur.botStrategy || cfg.strategy,
            quantity: cur.quantity,
            entryPrice: cur.entryPrice,
            exitPrice: exitMark,
            grossPnl: gross,
            fee,
            netPnl: net,
            exitAction: hitAction,
            confidenceAtEntry: cur.botConfidence ?? 70,
            stopLossDollars: cfg.stopLossDollars,
            takeProfitDollars: cfg.takeProfitDollars,
            openedAt: cur.openedAt,
            closedAt: now,
          },
          ...this.serverBot.closedTrades,
        ]);
        this.serverBot.executions = [
          {
            id: `sbex-${now}`,
            symbol: 'XAU/USD',
            side: cur.side,
            action: hitAction,
            quantity: cur.quantity,
            price: exitMark,
            realizedPnl: gross,
            fee,
            timestamp: now,
            source: 'XAU_BOT' as const,
            notes: `24/7 Server Bot ${hitAction}`,
          },
          ...this.serverBot.executions,
        ].slice(0, 200);
        this.appendServerBotLog(net >= 0 ? 'EXECUTION' : 'RISK', `Closed ${cur.side} ${cur.quantity} (${hitAction}) -> ${net >= 0 ? '+' : ''}$${net.toFixed(2)}`);
        stateDirty = true;
      } else {
        remaining.push(cur);
      }
    }
    this.serverBot.positions = remaining;

    // 2. Check Drawdown Circuit Breaker
    const pnl = this.computeServerBotPnl(xau);
    this.serverBot.netPnl = pnl.total;
    this.serverBot.dailyPnl = pnl.daily;

    if (pnl.daily <= -Math.abs(cfg.maxDailyLossDollars)) {
      this.serverBot.enabled = false;
      this.serverBot.config.enabled = false;
      this.serverBot.dailyLossPausedDay = bratislavaDay(now);
      this.appendServerBotLog('RISK', `Paused until tomorrow: max daily loss ($${cfg.maxDailyLossDollars}) reached.`);
      this.persistServerBotState();
      return;
    }

    // 3. Evaluate Entry Signals (News Guard + Spread Guard + MTF + Macro + Order Flow)
    const maxTrades = Math.max(1, Math.min(10, Math.round(cfg.maxConcurrentPositions || 3)));
    const cooldownMs = Math.max(5, cfg.cooldownSeconds || 25) * 1000;
    if (
      this.serverBot.positions.length < maxTrades &&
      now - this.serverBotLastTradeAt >= cooldownMs
    ) {
      const tfMap = this.candleCache.get('XAU/USD');
      const c15 = tfMap?.get('15m') || [];
      const c1h = tfMap?.get('1H') || [];
      const c5 = tfMap?.get('5m') || [];
      const bars = c5.length >= 22 ? c5 : c15;

      if (bars.length >= 22) {
        const spread = roundToDecimals(Math.max(0, xau.ask - xau.bid), 2);
        const cal = this.getEconomicCalendar(cfg.newsPauseMinutesBefore ?? 15, cfg.newsPauseMinutesAfter ?? 15);
        const macro = this.getGoldMacro();
        const prints = this.recentPrints.get('XAU/USD') || [];
        const buyPrints = prints.filter((p) => p.side === 'BUY').length;
        const buyPct = prints.length > 0 ? Math.round((buyPrints / prints.length) * 100) : 50;

        if ((cfg.useNewsGuard ?? true) && cal.newsGuardActive) {
          if (now - this.serverBotLastHoldLogAt >= 30_000) {
            this.serverBotLastHoldLogAt = now;
            this.appendServerBotLog('RISK', `News Guard paused: ${cal.activeGuardEvent?.title}`);
          }
        } else if ((cfg.useSessionSpreadGuard ?? true) && spread > (cfg.maxSpreadDollars ?? 1.2)) {
          if (now - this.serverBotLastHoldLogAt >= 30_000) {
            this.serverBotLastHoldLogAt = now;
            this.appendServerBotLog('RISK', `Spread Guard paused: $${spread.toFixed(2)}/oz`);
          }
        } else {
          const ema9 = serverEmaLast(bars, 9);
          const ema21 = serverEmaLast(bars, 21);
          const rsi = serverRsiLast(bars, 14);
          let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
          let conf = 45;

          if (ema9 > ema21 && rsi >= 50 && rsi <= 72) {
            action = 'BUY';
            conf = 64;
          } else if (ema9 < ema21 && rsi <= 50 && rsi >= 28) {
            action = 'SELL';
            conf = 64;
          }

          if (action !== 'HOLD' && (cfg.useOrderFlowConfluence ?? true) && prints.length >= 4) {
            if (action === 'BUY' && buyPct >= 56) conf += 8;
            else if (action === 'BUY' && buyPct <= 40) conf -= 14;
            else if (action === 'SELL' && buyPct <= 44) conf += 8;
            else if (action === 'SELL' && buyPct >= 60) conf -= 14;
          }

          if (action !== 'HOLD' && (cfg.useMtfConfluence ?? true) && c15.length >= 22 && c1h.length >= 22) {
            const e9_15 = serverEmaLast(c15, 9);
            const e21_15 = serverEmaLast(c15, 21);
            const e9_1h = serverEmaLast(c1h, 9);
            const e21_1h = serverEmaLast(c1h, 21);
            const bull15 = e9_15 > e21_15;
            const bull1h = e9_1h > e21_1h;
            if ((action === 'BUY' && bull15 && bull1h) || (action === 'SELL' && !bull15 && !bull1h)) conf += 9;
            else if ((action === 'BUY' && !bull15 && !bull1h) || (action === 'SELL' && bull15 && bull1h)) conf -= 16;
          }

          if (action !== 'HOLD' && (cfg.useMacroConfluence ?? true)) {
            if ((action === 'BUY' && macro.macroBias === 'BULLISH') || (action === 'SELL' && macro.macroBias === 'BEARISH')) conf += 6;
            else if ((action === 'BUY' && macro.macroBias === 'BEARISH') || (action === 'SELL' && macro.macroBias === 'BULLISH')) conf -= 8;
          }

          if (action !== 'HOLD' && conf >= cfg.minConfidence) {
            const fill = action === 'BUY' ? xau.ask : xau.bid;
            const sameSide = this.serverBot.positions.filter((p) => p.side === action);
            const closestDist = sameSide.length > 0 ? Math.min(...sameSide.map((p) => Math.abs(p.entryPrice - fill))) : 999;

            if (sameSide.length === 0 || closestDist >= 1.5 || conf >= 76) {
              const tierIdx = sameSide.length;
              const tpMult = roundToDecimals(1 + tierIdx * 0.35, 2);
              const sl = roundToDecimals(action === 'BUY' ? fill - cfg.stopLossDollars : fill + cfg.stopLossDollars, 2);
              const tp = roundToDecimals(action === 'BUY' ? fill + cfg.takeProfitDollars * tpMult : fill - cfg.takeProfitDollars * tpMult, 2);
              const trail = tierIdx > 0 ? cfg.trailingStopDollars ?? Math.max(4.5, roundToDecimals(cfg.stopLossDollars * 0.75, 2)) : cfg.trailingStopDollars;
              const fee = roundToDecimals(cfg.lotSize * xau.commissionPerUnit, 2);

              if (!this.brokerOrderInFlight && this.shouldRouteRealBroker()) {
                this.brokerOrderInFlight = true;
                void this.routeBrokerOpenOrder({
                  side: action,
                  lotSize: cfg.lotSize,
                  stopLoss: sl,
                  takeProfit: tp,
                  estimatedPrice: fill,
                }).then((brokerRes) => {
                  this.brokerOrderInFlight = false;
                  if (!brokerRes.ok) {
                    this.appendServerBotLog(
                      'RISK',
                      `Broker rejected ${action} ${cfg.lotSize} XAU/USD: ${brokerRes.error || 'Unknown error'}`,
                    );
                    this.persistServerBotState();
                    return;
                  }
                  const actualFill = brokerRes.fillPrice || fill;
                  const newPos: Position = {
                    id: `sbpos-${now}-${Math.random().toString(36).slice(2, 6)}`,
                    symbol: 'XAU/USD',
                    side: action,
                    quantity: cfg.lotSize,
                    entryPrice: actualFill,
                    leverage: cfg.leverage,
                    marginUsed: roundToDecimals((actualFill * cfg.lotSize * xau.contractSize) / cfg.leverage, 2),
                    stopLoss: sl,
                    takeProfit: tp,
                    trailingStopDistance: trail,
                    peakFavorablePrice: actualFill,
                    openedAt: now,
                    commissionPaid: fee,
                    source: 'XAU_BOT',
                    botStrategy: cfg.strategy,
                    botConfidence: conf,
                    brokerOrderId: brokerRes.brokerTradeId,
                    brokerProvider: brokerRes.provider,
                  };
                  this.serverBot.positions = [newPos, ...this.serverBot.positions];
                  this.serverBot.executions = [
                    {
                      id: `sbex-open-${now}-${Math.random().toString(36).slice(2, 5)}`,
                      symbol: 'XAU/USD',
                      side: action,
                      action: 'OPEN' as const,
                      quantity: cfg.lotSize,
                      price: actualFill,
                      realizedPnl: 0,
                      fee,
                      timestamp: now,
                      source: 'XAU_BOT' as const,
                      notes: `${brokerRes.provider} #${brokerRes.brokerTradeId || 'LIVE'}`,
                    },
                    ...this.serverBot.executions,
                  ].slice(0, 200);
                  this.serverBotLastTradeAt = now;
                  this.appendServerBotLog(
                    'EXECUTION',
                    `[${brokerRes.provider}] Opened ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'} ${action} ${cfg.lotSize} XAU/USD @ ${actualFill.toFixed(2)} (ID ${brokerRes.brokerTradeId || 'OK'})`,
                  );
                  this.persistServerBotState();
                });
              } else if (!this.shouldRouteRealBroker()) {
                const newPos: Position = {
                  id: `sbpos-${now}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: 'XAU/USD',
                  side: action,
                  quantity: cfg.lotSize,
                  entryPrice: fill,
                  leverage: cfg.leverage,
                  marginUsed: roundToDecimals((fill * cfg.lotSize * xau.contractSize) / cfg.leverage, 2),
                  stopLoss: sl,
                  takeProfit: tp,
                  trailingStopDistance: trail,
                  peakFavorablePrice: fill,
                  openedAt: now,
                  commissionPaid: fee,
                  source: 'XAU_BOT',
                  botStrategy: cfg.strategy,
                  botConfidence: conf,
                  brokerProvider: 'SIMULATION',
                };
                this.serverBot.positions = [newPos, ...this.serverBot.positions];
                this.serverBot.executions = [
                  {
                    id: `sbex-open-${now}-${Math.random().toString(36).slice(2, 5)}`,
                    symbol: 'XAU/USD',
                    side: action,
                    action: 'OPEN' as const,
                    quantity: cfg.lotSize,
                    price: fill,
                    realizedPnl: 0,
                    fee,
                    timestamp: now,
                    source: 'XAU_BOT' as const,
                    notes: `24/7 Server ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'}`,
                  },
                  ...this.serverBot.executions,
                ].slice(0, 200);
                this.serverBotLastTradeAt = now;
                this.appendServerBotLog(
                  'EXECUTION',
                  `Opened ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'} ${action} ${cfg.lotSize} XAU/USD @ ${fill.toFixed(2)} (SL ${sl.toFixed(2)} / TP ${tp.toFixed(2)})`,
                );
                stateDirty = true;
              }
            }
          }
        }
      }
    }

    if (stateDirty) {
      this.persistServerBotState();
    }
  }

  private detectBrokerEnv() {
    const oandaToken = (process.env.OANDA_API_TOKEN || '').trim();
    const oandaAccount = (process.env.OANDA_ACCOUNT_ID || '').trim();
    const oandaEnv: 'practice' | 'live' =
      (process.env.OANDA_ENV || 'practice').toLowerCase() === 'live' ? 'live' : 'practice';
    if (oandaToken && oandaAccount) {
      return {
        provider: 'OANDA' as const,
        configured: true as const,
        environment: oandaEnv,
        oandaToken,
        oandaAccount,
        oandaBaseUrl: oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com',
      };
    }

    const metaToken = (process.env.METAAPI_TOKEN || '').trim();
    const metaAccount = (process.env.METAAPI_ACCOUNT_ID || '').trim();
    const metaSymbol = (process.env.METAAPI_SYMBOL_XAU || 'XAUUSD').trim();
    if (metaToken && metaAccount) {
      return {
        provider: 'METAAPI' as const,
        configured: true as const,
        environment: 'live' as const,
        metaToken,
        metaAccount,
        metaSymbol,
        metaBaseUrl: 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai',
      };
    }

    const webhookUrl = (process.env.BROKER_WEBHOOK_URL || '').trim();
    const webhookSecret = (process.env.BROKER_WEBHOOK_SECRET || '').trim();
    if (webhookUrl) {
      return {
        provider: 'WEBHOOK' as const,
        configured: true as const,
        environment: 'live' as const,
        webhookUrl,
        webhookSecret,
      };
    }

    return {
      provider: 'SIMULATION' as const,
      configured: false as const,
      environment: 'practice' as const,
    };
  }

  private shouldRouteRealBroker(): boolean {
    const env = this.detectBrokerEnv();
    return Boolean(this.serverBot.brokerRoutingArmed && env.configured);
  }

  getBrokerStatus(): BrokerStatus {
    const env = this.detectBrokerEnv();
    const routingArmed = Boolean(this.serverBot.brokerRoutingArmed && env.configured);
    let accountLabel = 'Paper Simulation Ledger';
    if (env.provider === 'OANDA') {
      accountLabel = `OANDA ${env.environment.toUpperCase()} (${env.oandaAccount.slice(0, 6)}...)`;
    } else if (env.provider === 'METAAPI') {
      accountLabel = `MetaApi MT4/MT5 (${env.metaAccount.slice(0, 8)}...)`;
    } else if (env.provider === 'WEBHOOK') {
      accountLabel = 'Custom Broker Webhook Bridge';
    }
    return {
      provider: env.provider,
      configured: env.configured,
      environment: env.environment,
      routingArmed,
      accountLabel: this.brokerCache.lastSyncedAt ? this.brokerCache.accountLabel : accountLabel,
      currency: this.brokerCache.currency,
      balance: this.brokerCache.balance,
      equity: this.brokerCache.equity,
      unrealizedPnl: this.brokerCache.unrealizedPnl,
      marginUsed: this.brokerCache.marginUsed,
      openPositionsCount: this.brokerCache.openPositionsCount,
      lastSyncedAt: this.brokerCache.lastSyncedAt,
      lastOrderSummary: this.brokerCache.lastOrderSummary,
      lastError: this.brokerCache.lastError,
    };
  }

  setBrokerRoutingArmed(armed: boolean): BrokerStatus {
    const env = this.detectBrokerEnv();
    if (armed && !env.configured) {
      this.brokerCache.lastError = 'No broker credentials set in server environment variables.';
      this.serverBot.brokerRoutingArmed = false;
      this.persistServerBotState();
      return this.getBrokerStatus();
    }
    this.serverBot.brokerRoutingArmed = armed;
    this.brokerCache.lastError = null;
    this.appendServerBotLog(
      armed ? 'RISK' : 'INFO',
      armed
        ? `Real Broker Routing ARMED (${env.provider} · ${env.environment.toUpperCase()}).`
        : 'Real Broker Routing DISARMED (Paper Simulation active).',
    );
    this.persistServerBotState();
    return this.getBrokerStatus();
  }

  async syncBrokerAccount(): Promise<BrokerStatus> {
    const env = this.detectBrokerEnv();
    if (!env.configured) {
      this.brokerCache.lastError = null;
      return this.getBrokerStatus();
    }

    try {
      if (env.provider === 'OANDA') {
        const res = await fetch(`${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/summary`, {
          headers: {Authorization: `Bearer ${env.oandaToken}`},
          signal: AbortSignal.timeout(6500),
        });
        if (!res.ok) {
          throw new Error(`OANDA HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          account?: {
            id?: string;
            alias?: string;
            currency?: string;
            balance?: string;
            NAV?: string;
            unrealizedPL?: string;
            marginUsed?: string;
            openTradeCount?: number;
          };
        };
        const acc = data.account;
        if (acc) {
          this.brokerCache = {
            ...this.brokerCache,
            accountLabel: acc.alias ? `OANDA: ${acc.alias}` : `OANDA ${env.environment.toUpperCase()}`,
            currency: acc.currency || 'USD',
            balance: acc.balance ? Number(parseFloat(acc.balance).toFixed(2)) : null,
            equity: acc.NAV ? Number(parseFloat(acc.NAV).toFixed(2)) : null,
            unrealizedPnl: acc.unrealizedPL ? Number(parseFloat(acc.unrealizedPL).toFixed(2)) : null,
            marginUsed: acc.marginUsed ? Number(parseFloat(acc.marginUsed).toFixed(2)) : null,
            openPositionsCount: Number(acc.openTradeCount || 0),
            lastSyncedAt: Date.now(),
            lastError: null,
          };
        }
      } else if (env.provider === 'METAAPI') {
        const [infoRes, posRes] = await Promise.all([
          fetch(`${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/account-information`, {
            headers: {'auth-token': env.metaToken},
            signal: AbortSignal.timeout(6500),
          }),
          fetch(`${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/positions`, {
            headers: {'auth-token': env.metaToken},
            signal: AbortSignal.timeout(6500),
          }),
        ]);
        if (!infoRes.ok) throw new Error(`MetaApi HTTP ${infoRes.status}`);
        const info = (await infoRes.json()) as {
          broker?: string;
          server?: string;
          currency?: string;
          balance?: number;
          equity?: number;
          margin?: number;
        };
        const posList = posRes.ok ? ((await posRes.json()) as unknown[]) : [];
        const balance = typeof info.balance === 'number' ? Number(info.balance.toFixed(2)) : null;
        const equity = typeof info.equity === 'number' ? Number(info.equity.toFixed(2)) : null;
        this.brokerCache = {
          ...this.brokerCache,
          accountLabel: `${info.broker || 'MT4/MT5'} (${info.server || 'MetaApi'})`,
          currency: info.currency || 'USD',
          balance,
          equity,
          unrealizedPnl: balance !== null && equity !== null ? Number((equity - balance).toFixed(2)) : null,
          marginUsed: typeof info.margin === 'number' ? Number(info.margin.toFixed(2)) : null,
          openPositionsCount: Array.isArray(posList) ? posList.length : 0,
          lastSyncedAt: Date.now(),
          lastError: null,
        };
      } else if (env.provider === 'WEBHOOK') {
        this.brokerCache.lastSyncedAt = Date.now();
        this.brokerCache.lastError = null;
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker sync failed';
    }
    return this.getBrokerStatus();
  }

  private async routeBrokerOpenOrder(params: {
    side: 'BUY' | 'SELL';
    lotSize: number;
    stopLoss: number;
    takeProfit: number;
    estimatedPrice: number;
  }): Promise<{ok: boolean; provider: BrokerProvider; brokerTradeId?: string; fillPrice?: number; error?: string}> {
    const env = this.detectBrokerEnv();
    if (!env.configured) return {ok: false, provider: 'SIMULATION', error: 'No broker configured'};

    try {
      if (env.provider === 'OANDA') {
        const unitsNum = Math.max(1, Math.round(params.lotSize * 100));
        const units = params.side === 'BUY' ? String(unitsNum) : String(-unitsNum);
        const res = await fetch(`${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.oandaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order: {
              type: 'MARKET',
              instrument: 'XAU_USD',
              units,
              timeInForce: 'FOK',
              positionFill: 'DEFAULT',
              stopLossOnFill: {price: params.stopLoss.toFixed(2)},
              takeProfitOnFill: {price: params.takeProfit.toFixed(2)},
            },
          }),
          signal: AbortSignal.timeout(7000),
        });
        const data = (await res.json()) as {
          orderFillTransaction?: {id?: string; price?: string; tradeOpened?: {tradeID?: string}};
          orderCancelTransaction?: {reason?: string};
          errorMessage?: string;
        };
        if (!res.ok || data.orderCancelTransaction) {
          const msg = data.orderCancelTransaction?.reason || data.errorMessage || `OANDA HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'OANDA', error: msg};
        }
        const tradeId = data.orderFillTransaction?.tradeOpened?.tradeID || data.orderFillTransaction?.id;
        const fillPrice = data.orderFillTransaction?.price ? parseFloat(data.orderFillTransaction.price) : params.estimatedPrice;
        this.brokerCache.lastOrderSummary = `OANDA ${params.side} ${params.lotSize} XAU_USD @ ${fillPrice.toFixed(2)}`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'OANDA', brokerTradeId: tradeId, fillPrice};
      }

      if (env.provider === 'METAAPI') {
        const res = await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              actionType: params.side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
              symbol: env.metaSymbol,
              volume: params.lotSize,
              stopLoss: params.stopLoss,
              takeProfit: params.takeProfit,
              comment: 'Kestrel 24/7 XAU Bot',
            }),
            signal: AbortSignal.timeout(8000),
          },
        );
        const data = (await res.json()) as {positionId?: string; orderId?: string; stringCode?: string; message?: string};
        if (!res.ok) {
          const msg = data.message || data.stringCode || `MetaApi HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'METAAPI', error: msg};
        }
        const brokerTradeId = data.positionId || data.orderId;
        this.brokerCache.lastOrderSummary = `MT4/MT5 ${params.side} ${params.lotSize} ${env.metaSymbol}`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'METAAPI', brokerTradeId, fillPrice: params.estimatedPrice};
      }

      if (env.provider === 'WEBHOOK') {
        const res = await fetch(env.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.webhookSecret ? {Authorization: `Bearer ${env.webhookSecret}`} : {}),
          },
          body: JSON.stringify({
            event: 'OPEN',
            symbol: 'XAU/USD',
            side: params.side,
            lotSize: params.lotSize,
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
            timestamp: Date.now(),
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          const msg = `Webhook HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'WEBHOOK', error: msg};
        }
        const whId = `wh-${Date.now()}`;
        this.brokerCache.lastOrderSummary = `Webhook ${params.side} ${params.lotSize} XAU/USD`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'WEBHOOK', brokerTradeId: whId, fillPrice: params.estimatedPrice};
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Broker request failed';
      this.brokerCache.lastError = msg;
      return {ok: false, provider: env.provider, error: msg};
    }

    return {ok: false, provider: 'SIMULATION', error: 'Unsupported provider'};
  }

  private async routeBrokerCloseOrder(pos: Position, fraction = 1) {
    if (!pos.brokerOrderId || !this.shouldRouteRealBroker()) return;
    const env = this.detectBrokerEnv();
    try {
      if (env.provider === 'OANDA') {
        const units =
          fraction >= 0.999 ? 'ALL' : String(Math.max(1, Math.round(pos.quantity * fraction * 100)));
        await fetch(
          `${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/trades/${encodeURIComponent(pos.brokerOrderId)}/close`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${env.oandaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({units}),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'METAAPI') {
        const vol = roundToDecimals(pos.quantity * fraction, 2);
        await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              fraction >= 0.999
                ? {actionType: 'POSITION_CLOSE_ID', positionId: pos.brokerOrderId}
                : {actionType: 'POSITION_PARTIAL', positionId: pos.brokerOrderId, volume: vol},
            ),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'WEBHOOK') {
        await fetch(env.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.webhookSecret ? {Authorization: `Bearer ${env.webhookSecret}`} : {}),
          },
          body: JSON.stringify({
            event: fraction >= 0.999 ? 'CLOSE' : 'PARTIAL_CLOSE',
            brokerOrderId: pos.brokerOrderId,
            symbol: pos.symbol,
            side: pos.side,
            fraction,
            timestamp: Date.now(),
          }),
          signal: AbortSignal.timeout(6000),
        });
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker close sync failed';
    }
  }

  private async routeBrokerModifyRisk(pos: Position, stopLoss: number | null, takeProfit: number | null) {
    if (!pos.brokerOrderId || !this.shouldRouteRealBroker()) return;
    const env = this.detectBrokerEnv();
    try {
      if (env.provider === 'OANDA') {
        await fetch(
          `${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/trades/${encodeURIComponent(pos.brokerOrderId)}/orders`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${env.oandaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(stopLoss !== null ? {stopLoss: {price: stopLoss.toFixed(2)}} : {}),
              ...(takeProfit !== null ? {takeProfit: {price: takeProfit.toFixed(2)}} : {}),
            }),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'METAAPI') {
        await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              actionType: 'POSITION_MODIFY',
              positionId: pos.brokerOrderId,
              ...(stopLoss !== null ? {stopLoss} : {}),
              ...(takeProfit !== null ? {takeProfit} : {}),
            }),
            signal: AbortSignal.timeout(6500),
          },
        );
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker risk update failed';
    }
  }

  resetServerBotState(): ServerBotState {
    if (this.serverBot.positions.length > 0) {
      for (const pos of this.serverBot.positions) {
        void this.routeBrokerCloseOrder(pos, 1);
      }
    }
    this.serverBot = {
      enabled: false,
      config: {...this.serverBot.config, enabled: false},
      positions: [],
      closedTrades: [],
      executions: [],
      logs: [
        {
          id: `sbl-reset-${Date.now()}`,
          timestamp: Date.now(),
          level: 'INFO',
          message: '[24/7 Server] Ledger reset to clean baseline ($0.00 P&L).',
        },
      ],
      netPnl: 0,
      lastEvaluatedAt: 0,
      brokerRoutingArmed: this.serverBot.brokerRoutingArmed,
    };
    this.persistServerBotState();
    return this.getServerBotState();
  }

  restoreServerBotState(payload: Partial<ServerBotState>): ServerBotState {
    // Only restore if this server instance is completely clean/freshly booted
    const serverIsClean =
      !this.serverBot.enabled &&
      this.serverBot.positions.length === 0 &&
      this.serverBot.closedTrades.length === 0 &&
      this.serverBot.executions.length === 0 &&
      this.serverBot.lastEvaluatedAt === 0;
    if (!serverIsClean) {
      return this.getServerBotState();
    }
    const now = Date.now();
    this.serverBot = {
      enabled: Boolean(payload.enabled),
      config: {
        ...createServerBotDefaultConfig(),
        ...(payload.config || {}),
        enabled: Boolean(payload.enabled),
      },
      positions: Array.isArray(payload.positions) ? payload.positions.slice(0, 20) : [],
      closedTrades: Array.isArray(payload.closedTrades) ? payload.closedTrades.slice(0, 200) : [],
      executions: Array.isArray(payload.executions) ? payload.executions.slice(0, 200) : [],
      logs: Array.isArray(payload.logs) ? payload.logs.slice(0, 80) : [],
      netPnl: typeof payload.netPnl === 'number' ? payload.netPnl : 0,
      lastEvaluatedAt: now,
      brokerRoutingArmed: Boolean(payload.brokerRoutingArmed),
      archivedRealizedPnl: typeof payload.archivedRealizedPnl === 'number' ? payload.archivedRealizedPnl : 0,
    };
    this.appendServerBotLog(
      'INFO',
      `Restored ${this.serverBot.positions.length} open / ${this.serverBot.closedTrades.length} closed trades after server restart.`,
    );
    this.persistServerBotState();
    return this.getServerBotState();
  }

  getServerBotState(): ServerBotState {
    const pnl = this.computeServerBotPnl(this.instruments.get('XAU/USD'));
    return {
      ...this.serverBot,
      netPnl: pnl.total,
      dailyPnl: pnl.daily,
      brokerStatus: this.getBrokerStatus(),
      machineId: process.env.FLY_MACHINE_ID || process.env.HOSTNAME || 'local',
      bootId: SERVER_BOOT_ID,
      storagePersistent: HAS_PERSISTENT_VOLUME,
    };
  }

  updateServerBotConfig(next: Partial<XauBotConfig> & {enabled?: boolean}): ServerBotState {
    const merged: XauBotConfig = {
      ...this.serverBot.config,
      ...next,
    };
    const wasEnabled = this.serverBot.enabled;
    const nowEnabled = next.enabled !== undefined ? next.enabled : merged.enabled;
    merged.enabled = nowEnabled;
    this.serverBot.config = merged;
    this.serverBot.enabled = nowEnabled;
    // A manual on/off overrides the automatic resume after a daily-loss pause.
    if (next.enabled !== undefined) this.serverBot.dailyLossPausedDay = undefined;
    if (wasEnabled !== nowEnabled) {
      this.appendServerBotLog(
        'INFO',
        nowEnabled
          ? `24/7 Server Worker STARTED (${merged.strategy}, up to ${merged.maxConcurrentPositions} trades).`
          : '24/7 Server Worker PAUSED.',
      );
    }
    this.persistServerBotState();
    return this.getServerBotState();
  }

  closeAllServerBotPositions(): ServerBotState {
    const xau = this.instruments.get('XAU/USD');
    const now = Date.now();
    if (xau && this.serverBot.positions.length > 0) {
      for (const pos of this.serverBot.positions) {
        void this.routeBrokerCloseOrder(pos, 1);
        const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
        const diff = pos.side === 'BUY' ? exitMark - pos.entryPrice : pos.entryPrice - exitMark;
        const gross = roundToDecimals(diff * pos.quantity * xau.contractSize, 2);
        const fee = roundToDecimals(pos.quantity * xau.commissionPerUnit * 2, 2);
        const net = roundToDecimals(gross - fee, 2);
        this.serverBot.closedTrades = this.capClosedTrades([
          {
            id: `sbtr-${now}-${Math.random().toString(36).slice(2, 5)}`,
            positionId: pos.id,
            symbol: 'XAU/USD',
            side: pos.side,
            strategy: pos.botStrategy || this.serverBot.config.strategy,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            exitPrice: exitMark,
            grossPnl: gross,
            fee,
            netPnl: net,
            exitAction: 'CLOSE' as const,
            confidenceAtEntry: pos.botConfidence ?? 70,
            stopLossDollars: this.serverBot.config.stopLossDollars,
            takeProfitDollars: this.serverBot.config.takeProfitDollars,
            openedAt: pos.openedAt,
            closedAt: now,
          },
          ...this.serverBot.closedTrades,
        ]);
        this.serverBot.executions = [
          {
            id: `sbex-close-${now}-${Math.random().toString(36).slice(2, 5)}`,
            symbol: 'XAU/USD',
            side: pos.side,
            action: 'CLOSE' as const,
            quantity: pos.quantity,
            price: exitMark,
            realizedPnl: gross,
            fee,
            timestamp: now,
            source: 'XAU_BOT' as const,
            notes: '24/7 Server Bot Flatten',
          },
          ...this.serverBot.executions,
        ].slice(0, 200);
      }
      this.appendServerBotLog('EXECUTION', `Closed all ${this.serverBot.positions.length} open server bot trades.`);
      this.serverBot.positions = [];
      this.persistServerBotState();
    }
    return this.getServerBotState();
  }

  closeServerBotPosition(positionId: string, fraction = 1): ServerBotState {
    const xau = this.instruments.get('XAU/USD');
    const pos = this.serverBot.positions.find((p) => p.id === positionId);
    if (!xau || !pos) return this.getServerBotState();

    const now = Date.now();
    const clampedFraction = Math.max(0.1, Math.min(1, fraction));
    void this.routeBrokerCloseOrder(pos, clampedFraction);
    const closeQty =
      clampedFraction >= 0.999
        ? pos.quantity
        : roundToDecimals(Math.max(0.01, pos.quantity * clampedFraction), 2);
    const actualFraction = Math.min(1, closeQty / pos.quantity);

    const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
    const diff = pos.side === 'BUY' ? exitMark - pos.entryPrice : pos.entryPrice - exitMark;
    const gross = roundToDecimals(diff * closeQty * xau.contractSize, 2);
    const fee = roundToDecimals(closeQty * xau.commissionPerUnit * 2, 2);
    const net = roundToDecimals(gross - fee, 2);
    const exitAction = actualFraction >= 0.999 ? ('CLOSE' as const) : ('PARTIAL_CLOSE' as const);

    if (actualFraction >= 0.999) {
      this.serverBot.positions = this.serverBot.positions.filter((p) => p.id !== positionId);
    } else {
      const remQty = roundToDecimals(pos.quantity - closeQty, 2);
      if (remQty <= 0) {
        this.serverBot.positions = this.serverBot.positions.filter((p) => p.id !== positionId);
      } else {
        this.serverBot.positions = this.serverBot.positions.map((p) =>
          p.id === positionId
            ? {
                ...p,
                quantity: remQty,
                marginUsed: roundToDecimals(p.marginUsed * (1 - actualFraction), 2),
              }
            : p,
        );
      }
    }

    this.serverBot.closedTrades = this.capClosedTrades([
      {
        id: `sbtr-${now}-${Math.random().toString(36).slice(2, 5)}`,
        positionId: actualFraction >= 0.999 ? pos.id : `${pos.id}-p`,
        symbol: 'XAU/USD',
        side: pos.side,
        strategy: pos.botStrategy || this.serverBot.config.strategy,
        quantity: closeQty,
        entryPrice: pos.entryPrice,
        exitPrice: exitMark,
        grossPnl: gross,
        fee,
        netPnl: net,
        exitAction,
        confidenceAtEntry: pos.botConfidence ?? 70,
        stopLossDollars: this.serverBot.config.stopLossDollars,
        takeProfitDollars: this.serverBot.config.takeProfitDollars,
        openedAt: pos.openedAt,
        closedAt: now,
      },
      ...this.serverBot.closedTrades,
    ]);

    this.serverBot.executions = [
      {
        id: `sbex-${now}-${Math.random().toString(36).slice(2, 5)}`,
        symbol: 'XAU/USD',
        side: pos.side,
        action: exitAction,
        quantity: closeQty,
        price: exitMark,
        realizedPnl: gross,
        fee,
        timestamp: now,
        source: 'XAU_BOT' as const,
        notes: actualFraction >= 0.999 ? 'Manual close (24/7 Server)' : 'Partial 50% close (24/7 Server)',
      },
      ...this.serverBot.executions,
    ].slice(0, 200);

    this.appendServerBotLog(
      net >= 0 ? 'EXECUTION' : 'RISK',
      `Closed ${pos.side} ${closeQty} XAU/USD (Manual) -> ${net >= 0 ? '+' : ''}$${net.toFixed(2)}`,
    );
    this.persistServerBotState();
    return this.getServerBotState();
  }

  updateServerBotPositionRisk(
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ): ServerBotState {
    const pos = this.serverBot.positions.find((p) => p.id === positionId);
    if (!pos) return this.getServerBotState();
    void this.routeBrokerModifyRisk(pos, stopLoss, takeProfit);
    this.serverBot.positions = this.serverBot.positions.map((p) =>
      p.id === positionId ? {...p, stopLoss, takeProfit} : p,
    );
    this.appendServerBotLog(
      'RISK',
      `Updated ${pos.side} ${pos.quantity} risk -> SL ${stopLoss ?? '--'} / TP ${takeProfit ?? '--'}`,
    );
    this.persistServerBotState();
    return this.getServerBotState();
  }

  private async pollYahooQuotes() {
    if (this.yahooInFlight) return;
    this.yahooInFlight = true;
    try {
      const yahooSeeds = SEEDS.filter((s) => s.yahooSymbol && !s.swissquotePair);
      const fxYahooSeeds = SEEDS.filter((s) => s.yahooSymbol && s.swissquotePair);

    await Promise.all([
      ...yahooSeeds.map(async (seed) => {
        const data = await fetchJsonWithTimeout<YahooChartResponse>(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            seed.yahooSymbol!,
          )}?range=1d&interval=1m`,
          4500,
        );
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) return;
        this.applyQuoteUpdate(seed.symbol, {
          price: meta.regularMarketPrice,
          open24h: meta.chartPreviousClose || meta.previousClose,
          high24h: meta.regularMarketDayHigh,
          low24h: meta.regularMarketDayLow,
          volume24h: meta.regularMarketVolume,
          feedStatus: 'LIVE',
        });
      }),
      // For Swissquote live pairs, grab 24h open/high/low from Yahoo so daily % change is accurate
      ...fxYahooSeeds.map(async (seed) => {
        const data = await fetchJsonWithTimeout<YahooChartResponse>(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            seed.yahooSymbol!,
          )}?range=1d&interval=5m`,
          4500,
        );
        const meta = data?.chart?.result?.[0]?.meta;
        const inst = this.instruments.get(seed.symbol);
        if (!meta || !inst) return;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        if (prevClose && prevClose > 0) {
          // For XAU/USD vs GC=F, keep slight futures/spot basis aligned
          if (seed.symbol === 'XAU/USD' && inst.price > 0) {
            const basis = inst.price / (meta.regularMarketPrice || inst.price);
            inst.open24h = roundToDecimals(prevClose * basis, seed.decimals);
          } else {
            inst.open24h = roundToDecimals(prevClose, seed.decimals);
          }
          inst.changePct = roundToDecimals(
            ((inst.price - inst.open24h) / inst.open24h) * 100,
            2,
          );
        }
      }),
      // Macro intermarket correlation feeds for Gold: DXY (Dollar Index) & ^TNX (US 10Y Treasury Yield)
      (async () => {
        const [dxyRes, tnxRes] = await Promise.all([
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=1d&interval=5m',
            4500,
          ),
        ]);
        const dxyMeta = dxyRes?.chart?.result?.[0]?.meta;
        if (dxyMeta?.regularMarketPrice) {
          const prev = dxyMeta.chartPreviousClose || dxyMeta.previousClose || dxyMeta.regularMarketPrice;
          this.macroGold.dxyPrice = roundToDecimals(dxyMeta.regularMarketPrice, 3);
          this.macroGold.dxyChangePct =
            prev > 0 ? roundToDecimals(((dxyMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
          this.macroGold.updatedAt = Date.now();
          this.macroGold.live = true;
        }
        const tnxMeta = tnxRes?.chart?.result?.[0]?.meta;
        if (tnxMeta?.regularMarketPrice) {
          const prev = tnxMeta.chartPreviousClose || tnxMeta.previousClose || tnxMeta.regularMarketPrice;
          this.macroGold.us10yYield = roundToDecimals(tnxMeta.regularMarketPrice, 3);
          this.macroGold.us10yChangePct =
            prev > 0 ? roundToDecimals(((tnxMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
          this.macroGold.updatedAt = Date.now();
          this.macroGold.live = true;
        }
      })(),
    ]);

      this.broadcastTick();
    } catch (err) {
      console.error('[feed] pollYahooQuotes error:', err);
    } finally {
      this.yahooInFlight = false;
    }
  }

  async fetchLiveCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    const seed = this.seeds.get(symbol);
    if (!seed) return [];

    const cacheKey = `${symbol}:${timeframe}`;
    const lastFetch = this.candleFetchedAt.get(cacheKey) || 0;
    const tfMap = this.candleCache.get(symbol)!;
    const existing = tfMap.get(timeframe);
    if (existing && existing.length > 0 && Date.now() - lastFetch < 25_000) {
      return existing;
    }

    let parsed: Candle[] = [];

    if (seed.krakenPair) {
      const intervalMap: Record<Timeframe, number> = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1H': 60,
        '4H': 240,
        '1D': 1440,
      };
      const data = await fetchJsonWithTimeout<KrakenOHLCResponse>(
        `https://api.kraken.com/0/public/OHLC?pair=${seed.krakenPair}&interval=${intervalMap[timeframe]}`,
        5000,
      );
      const key = data?.result
        ? Object.keys(data.result).find((k) => k !== 'last')
        : undefined;
      const rows = key ? data?.result?.[key] : undefined;
      if (rows && rows.length > 0) {
        parsed = rows.slice(-220).map((r) => ({
          time: Number(r[0]),
          open: roundToDecimals(parseFloat(r[1]), seed.decimals),
          high: roundToDecimals(parseFloat(r[2]), seed.decimals),
          low: roundToDecimals(parseFloat(r[3]), seed.decimals),
          close: roundToDecimals(parseFloat(r[4]), seed.decimals),
          volume: Math.round(parseFloat(r[6]) * 100) / 100,
        }));
      }
    } else if (seed.yahooSymbol) {
      const yahooParams: Record<Timeframe, {interval: string; range: string}> = {
        '1m': {interval: '1m', range: '1d'},
        '5m': {interval: '5m', range: '5d'},
        '15m': {interval: '15m', range: '5d'},
        '1H': {interval: '1h', range: '1mo'},
        '4H': {interval: '1h', range: '3mo'},
        '1D': {interval: '1d', range: '1y'},
      };
      const {interval, range} = yahooParams[timeframe];
      const data = await fetchJsonWithTimeout<YahooChartResponse>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          seed.yahooSymbol,
        )}?range=${range}&interval=${interval}`,
        5500,
      );
      const res = data?.chart?.result?.[0];
      const timestamps = res?.timestamp || [];
      const quote = res?.indicators?.quote?.[0];
      if (timestamps.length > 0 && quote) {
        const raw: Candle[] = [];
        // Scale GC=F futures bars to Spot XAU/USD if basis exists
        const currentInst = this.instruments.get(symbol);
        const refMetaPrice = res?.meta?.regularMarketPrice;
        const scale =
          symbol === 'XAU/USD' && currentInst && refMetaPrice && refMetaPrice > 0
            ? currentInst.price / refMetaPrice
            : 1;

        for (let i = 0; i < timestamps.length; i++) {
          const o = quote.open?.[i];
          const h = quote.high?.[i];
          const l = quote.low?.[i];
          const c = quote.close?.[i];
          if (o == null || h == null || l == null || c == null) continue;
          raw.push({
            time: timestamps[i],
            open: roundToDecimals(o * scale, seed.decimals),
            high: roundToDecimals(h * scale, seed.decimals),
            low: roundToDecimals(l * scale, seed.decimals),
            close: roundToDecimals(c * scale, seed.decimals),
            volume: Math.round(quote.volume?.[i] ?? 100),
          });
        }
        parsed = (timeframe === '4H' ? aggregateCandles4H(raw) : raw).slice(-220);
      }
    }

    if (parsed.length > 0) {
      tfMap.set(timeframe, parsed);
      this.candleFetchedAt.set(cacheKey, Date.now());
      if (timeframe === '15m') {
        const inst = this.instruments.get(symbol);
        if (inst) inst.sparkline = parsed.slice(-24).map((c) => c.close);
      }
      return parsed;
    }

    if (existing && existing.length > 0) return existing;
    const currentPrice = this.instruments.get(symbol)?.price || seed.fallbackPrice;
    const fallback = generateFallbackCandles(seed, timeframe, 120, currentPrice);
    tfMap.set(timeframe, fallback);
    return fallback;
  }

  getMarkets(): Instrument[] {
    return Array.from(this.instruments.values());
  }

  getOrderFlow(symbol: string): {
    symbol: string;
    timestamp: number;
    recentPrints: MarketPrint[];
    tiers: SpreadTier[];
  } {
    return {
      symbol,
      timestamp: Date.now(),
      recentPrints: this.recentPrints.get(symbol) || [],
      tiers: this.spreadTiers.get(symbol) || [],
    };
  }

  getGoldMacro() {
    const xau = this.instruments.get('XAU/USD');
    const gc = this.instruments.get('GC1!');
    const xauSpotPrice = xau?.price ?? 0;
    const gcFuturesPrice = gc?.price ?? 0;
    const gcBasis =
      xauSpotPrice > 0 && gcFuturesPrice > 0
        ? roundToDecimals(gcFuturesPrice - xauSpotPrice, 2)
        : 0;

    let macroScore = 0;
    // Gold moves inversely to DXY
    if (this.macroGold.dxyChangePct <= -0.2) macroScore += 6;
    else if (this.macroGold.dxyChangePct <= -0.05) macroScore += 3;
    else if (this.macroGold.dxyChangePct >= 0.2) macroScore -= 6;
    else if (this.macroGold.dxyChangePct >= 0.05) macroScore -= 3;

    // Gold moves inversely to US 10Y Treasury yields
    if (this.macroGold.us10yChangePct <= -0.6) macroScore += 4;
    else if (this.macroGold.us10yChangePct <= -0.15) macroScore += 2;
    else if (this.macroGold.us10yChangePct >= 0.6) macroScore -= 4;
    else if (this.macroGold.us10yChangePct >= 0.15) macroScore -= 2;

    // COMEX GC1! futures lead vs XAU/USD spot
    if (gc && xau) {
      if (gc.changePct > xau.changePct + 0.05 && gcBasis > 0) macroScore += 3;
      else if (gc.changePct < xau.changePct - 0.05) macroScore -= 3;
    }

    const macroBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      macroScore >= 3 ? 'BULLISH' : macroScore <= -3 ? 'BEARISH' : 'NEUTRAL';

    return {
      dxyPrice: this.macroGold.dxyPrice,
      dxyChangePct: this.macroGold.dxyChangePct,
      us10yYield: this.macroGold.us10yYield,
      us10yChangePct: this.macroGold.us10yChangePct,
      xauSpotPrice,
      gcFuturesPrice,
      gcBasis,
      macroBias,
      macroScore,
      updatedAt: this.macroGold.updatedAt || Date.now(),
      live: this.macroGold.live,
    };
  }

  addSubscriber(res: express.Response) {
    this.subscribers.add(res);
  }

  removeSubscriber(res: express.Response) {
    this.subscribers.delete(res);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const engine = new LiveMarketEngine();

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok', timestamp: Date.now()});
  });

  app.get('/api/markets', (_req, res) => {
    res.json({
      timestamp: Date.now(),
      instruments: engine.getMarkets(),
    });
  });

  app.get('/api/orderflow/:symbol', (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    res.json(engine.getOrderFlow(symbol));
  });

  app.get('/api/macro/gold', (_req, res) => {
    res.json(engine.getGoldMacro());
  });

  app.get('/api/calendar', (req, res) => {
    const before = Number(req.query.before) || 15;
    const after = Number(req.query.after) || 15;
    res.json(engine.getEconomicCalendar(before, after));
  });

  app.get('/api/bot/state', (_req, res) => {
    res.json(engine.getServerBotState());
  });

  app.post('/api/bot/config', (req, res) => {
    const updated = engine.updateServerBotConfig(req.body || {});
    res.json(updated);
  });

  app.post('/api/bot/close-all', (_req, res) => {
    res.json(engine.closeAllServerBotPositions());
  });

  app.post('/api/bot/close/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const fraction = typeof req.body?.fraction === 'number' ? req.body.fraction : 1;
    res.json(engine.closeServerBotPosition(id, fraction));
  });

  app.post('/api/bot/risk/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const stopLoss =
      typeof req.body?.stopLoss === 'number' && Number.isFinite(req.body.stopLoss)
        ? req.body.stopLoss
        : null;
    const takeProfit =
      typeof req.body?.takeProfit === 'number' && Number.isFinite(req.body.takeProfit)
        ? req.body.takeProfit
        : null;
    res.json(engine.updateServerBotPositionRisk(id, stopLoss, takeProfit));
  });

  app.post('/api/bot/reset', (_req, res) => {
    res.json(engine.resetServerBotState());
  });

  app.post('/api/bot/restore', (req, res) => {
    res.json(engine.restoreServerBotState(req.body || {}));
  });

  app.get('/api/broker/status', (_req, res) => {
    res.json(engine.getBrokerStatus());
  });

  app.post('/api/broker/sync', async (_req, res) => {
    res.json(await engine.syncBrokerAccount());
  });

  app.post('/api/broker/mode', (req, res) => {
    const armed = Boolean(req.body?.routingArmed);
    res.json(engine.setBrokerRoutingArmed(armed));
  });

  app.get('/api/candles/:symbol', async (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    const timeframe = (req.query.timeframe as Timeframe) || '15m';
    const validTf: Timeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
    const tf = validTf.includes(timeframe) ? timeframe : '15m';
    const candles = await engine.fetchLiveCandles(symbol, tf);
    if (!candles.length) {
      res.status(404).json({error: 'Instrument not found'});
      return;
    }
    res.json({symbol, timeframe: tf, candles});
  });

  app.get('/api/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    req.setTimeout(0);
    res.setTimeout(0);
    req.socket?.setTimeout(0);
    req.socket?.setNoDelay?.(true);
    res.flushHeaders?.();

    const initial = JSON.stringify({
      type: 'TICK',
      timestamp: Date.now(),
      instruments: engine.getMarkets(),
    });
    res.write(`retry: 3000\ndata: ${initial}\n\n`);

    engine.addSubscriber(res);
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        engine.removeSubscriber(res);
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        engine.removeSubscriber(res);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      engine.removeSubscriber(res);
    });
  });

  if (useViteDev) {
    try {
      const {createServer: createViteServer} = await import('vite');
      const vite = await createViteServer({
        server: {middlewareMode: true},
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[boot] Vite dev middleware unavailable, serving static dist:', err);
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log('[boot] binding HTTP server...', {
    port: PORT,
    useViteDev,
    hasBuiltDist,
    flyApp: process.env.FLY_APP_NAME || null,
    nodeEnv: process.env.NODE_ENV || null,
  });

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Kestrel Trade server (${useViteDev ? 'dev' : 'production'}) listening on http://0.0.0.0:${PORT}`,
    );
  });
  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.on('error', (err) => {
    console.error('[boot] HTTP server listen error:', err);
    process.exit(1);
  });
}

process.on('uncaughtException', (err) => {
  console.error('[runtime] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[runtime] Unhandled promise rejection:', reason);
});

startServer().catch((err) => {
  console.error('[boot] Fatal startup error:', err);
  process.exit(1);
});
