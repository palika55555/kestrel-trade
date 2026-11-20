import fs from 'fs';
import type express from 'express';
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
  DomLevel2Snapshot,
  DomWallInfo,
  DomWallVelocity,
  FuturesOiRegime,
  GoldMarketRegime,
  InstitutionalGoldContext,
  OrderSide,
  XauBotStrategy,
} from '../src/types/trading.ts';
import {BrokerBridge} from './broker/brokerBridge.ts';
import type {CTraderService} from './broker/ctrader/service.ts';
import {createServerBotDefaultConfig} from './botDefaults.ts';
import {HAS_PERSISTENT_VOLUME, SERVER_BOOT_ID, SERVER_BOT_STATE_PATH} from './config.ts';
import type {
  BinanceDepthResponse,
  BinanceOpenInterestResponse,
  BinancePremiumIndexResponse,
  BinanceTakerRatioRow,
  CoinbaseBookResponse,
  ForexFactoryRawEvent,
  KrakenDepthResponse,
  KrakenOHLCResponse,
  KrakenTickerResponse,
  KrakenTradesResponse,
  SpreadTier,
  SwissquoteQuote,
  YahooChartResponse,
} from './feedTypes.ts';
import {SEEDS, type InstrumentSeed} from './instruments.ts';
import {
  TIMEFRAME_SECONDS,
  aggregateCandles4H,
  isQuoteStale,
  bratislavaDay,
  buildSyntheticOrderBook,
  classifyDomWallVelocity,
  classifyFuturesOiRegime,
  computeOvernightSwapPnl,
  computeServerVolumeProfile,
  computeSessionOrbRange,
  detectSilverGoldSmt,
  fetchJsonWithTimeout,
  generateFallbackCandles,
  roundToDecimals,
  serverAdaptConfig,
  serverAtasBarSignals,
  serverAtr14,
  serverBollingerLast,
  serverDetectRegime,
  serverEmaLast,
  serverEmaPrev,
  serverInKillzone,
  serverRsiLast,
  serverVwapLast,
} from './marketUtils.ts';
import os from 'os';
import path from 'path';

export class LiveMarketEngine {
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
  // Wall-clock time of the last LIVE (non-fallback) quote per symbol; drives the stale-data guard.
  private lastLiveQuoteAt = new Map<string, number>();
  private persistFailing = false;
  private serverBotLastHoldLogAt = 0;
  private brokerOrderInFlight = false;
  private swissquoteInFlight = false;
  private mt5QuoteInFlight = false;
  private mt5LastLiveAt = 0;
  private mt5LastBroadcastAt = 0;
  private mt5HadLiveFeed = false;
  private yahooInFlight = false;
  private cotPositioning: CotPositioning | null = null;
  private instFlowLastPollAt = 0;
  private silverBarsLastPollAt = 0;
  private silver5mCandles: Candle[] = [];
  private futuresOiHistory: Array<{ts: number; oiOz: number; markPrice: number}> = [];
  private goldL2History: Array<{ts: number; top5Bid: number; top5Ask: number}> = [];
  private instFlow: {
    gvz: number | null;
    gvzChangePct: number;
    vix: number | null;
    vixChangePct: number;
    gldPrice: number | null;
    gldChangePct: number;
    gldVolume: number;
    paxgPrice: number | null;
    paxgBuyVolumeOz: number;
    paxgSellVolumeOz: number;
    paxgNetDeltaOz: number;
    paxgBuyPct: number;
    paxgBookBidPct: number;
    paxgLargePrints: Array<{
      id: string;
      price: number;
      sizeOz: number;
      side: OrderSide;
      timestamp: number;
    }>;
    futuresOiOz: number | null;
    futuresOiDeltaPct: number;
    futuresPriceDeltaPct: number;
    futuresFundingRate: number | null;
    futuresTakerBuySellRatio: number | null;
    tipPrice: number | null;
    tipChangePct: number;
    gdxPrice: number | null;
    gdxChangePct: number;
    silverPrice: number | null;
    silverChangePct: number;
    usdJpyPrice: number | null;
    usdJpyChangePct: number;
    updatedAt: number;
  } = {
    gvz: null,
    gvzChangePct: 0,
    vix: null,
    vixChangePct: 0,
    gldPrice: null,
    gldChangePct: 0,
    gldVolume: 0,
    paxgPrice: null,
    paxgBuyVolumeOz: 0,
    paxgSellVolumeOz: 0,
    paxgNetDeltaOz: 0,
    paxgBuyPct: 50,
    paxgBookBidPct: 50,
    paxgLargePrints: [],
    futuresOiOz: null,
    futuresOiDeltaPct: 0,
    futuresPriceDeltaPct: 0,
    futuresFundingRate: null,
    futuresTakerBuySellRatio: null,
    tipPrice: null,
    tipChangePct: 0,
    gdxPrice: null,
    gdxChangePct: 0,
    silverPrice: null,
    silverChangePct: 0,
    usdJpyPrice: null,
    usdJpyChangePct: 0,
    updatedAt: 0,
  };
  private goldL2Raw: {
    bids: Array<{offset: number; size: number; venue: string}>;
    asks: Array<{offset: number; size: number; venue: string}>;
    venues: string[];
    updatedAt: number;
  } = {
    bids: [],
    asks: [],
    venues: [],
    updatedAt: 0,
  };
  private btcL2Raw: {
    bids: Array<{price: number; size: number}>;
    asks: Array<{price: number; size: number}>;
    updatedAt: number;
  } = {
    bids: [],
    asks: [],
    updatedAt: 0,
  };
  private coinbaseLastPollAt = 0;

  private broker = new BrokerBridge({
    isRoutingArmed: () => Boolean(this.serverBot.brokerRoutingArmed),
    setRoutingArmed: (armed) => {
      this.serverBot.brokerRoutingArmed = armed;
    },
    persist: () => this.persistServerBotState(),
    log: (level, message) => this.appendServerBotLog(level, message),
  });

  getBrokerStatus(): BrokerStatus {
    return this.broker.getBrokerStatus();
  }

  setBrokerRoutingArmed(armed: boolean): BrokerStatus {
    return this.broker.setBrokerRoutingArmed(armed);
  }

  async syncBrokerAccount(): Promise<BrokerStatus> {
    const status = await this.broker.syncBrokerAccount();
    if (this.broker.isMt5Configured()) {
      for (const key of Array.from(this.candleFetchedAt.keys())) {
        if (key.startsWith('XAU/USD:')) this.candleFetchedAt.delete(key);
      }
      void this.pollMt5Tick();
      void this.refreshMt5Candles();
    }
    return status;
  }

  getCTraderService(): CTraderService | null {
    return this.broker.getCTraderService();
  }

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
    this.pollMt5Tick();
    this.pollSwissquoteAndKraken();
    this.pollYahooQuotes();
    this.preloadInitialCandles();
    this.fetchEconomicCalendar();
    this.fetchCftcCot();

    setInterval(() => this.pollMt5Tick(), 500);
    setInterval(() => this.pollSwissquoteAndKraken(), 1000);
    setInterval(() => this.pollYahooQuotes(), 3000);
    setInterval(() => void this.broker.refreshIfRouting(), 10_000);
    setInterval(() => this.fetchEconomicCalendar(), 15 * 60_000);
    setInterval(() => this.fetchCftcCot(), 6 * 3600_000);
  }

  private loadServerBotState() {
    // Before the move to ./data the state file lived in the working directory; pick it up once.
    const legacyPath = path.resolve(process.cwd(), '.kestrel-server-bot.json');
    const sourcePath = fs.existsSync(SERVER_BOT_STATE_PATH)
      ? SERVER_BOT_STATE_PATH
      : fs.existsSync(legacyPath)
      ? legacyPath
      : null;
    try {
      if (sourcePath) {
        const raw = fs.readFileSync(sourcePath, 'utf8');
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
    } catch (err) {
      // Keep the unreadable file aside so the next save does not overwrite the only copy.
      const backupPath = `${sourcePath}.corrupt-${Date.now()}`;
      console.error(`[bot] Could not read bot state from ${sourcePath}; starting fresh, original kept at ${backupPath}:`, err);
      try {
        if (sourcePath) fs.copyFileSync(sourcePath, backupPath);
      } catch (copyErr) {
        console.error('[bot] Could not back up the unreadable state file:', copyErr);
      }
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
          const swapPnl = computeOvernightSwapPnl(
            p.side,
            p.quantity,
            p.openedAt,
            Date.now(),
            xau.overnightSwapLong,
            xau.overnightSwapShort,
          );
          return a + d * p.quantity * xau.contractSize - (p.commissionPaid || 0) + swapPnl;
        }, 0)
      : 0;
    return {
      total: roundToDecimals(realizedAll + unreal, 2),
      daily: roundToDecimals(realizedToday + unreal, 2),
    };
  }

  private persistServerBotState() {
    // Write to a temp file and rename so a crash mid-write never leaves a truncated state file.
    const tmpPath = `${SERVER_BOT_STATE_PATH}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(this.serverBot), 'utf8');
      fs.renameSync(tmpPath, SERVER_BOT_STATE_PATH);
      if (this.persistFailing) {
        this.persistFailing = false;
        console.info('[bot] State persistence recovered.');
        this.appendServerBotLog('INFO', 'Bot state is being saved to disk again.');
      }
    } catch (err) {
      // Report once per failure streak instead of on every tick.
      if (!this.persistFailing) {
        this.persistFailing = true;
        console.error(`[bot] Failed to save bot state to ${SERVER_BOT_STATE_PATH}:`, err);
        this.appendServerBotLog(
          'RISK',
          'Bot state could NOT be saved to disk — open trades may be lost on restart. Check the server log.',
        );
      }
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

  async fetchCftcCot() {
    try {
      const rows = await fetchJsonWithTimeout<Array<Record<string, string>>>(
        'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?cftc_contract_market_code=088691&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=2',
        7000,
      );
      if (!Array.isArray(rows) || rows.length === 0) return;
      const latest = rows[0];
      const prev = rows[1];
      const num = (r: Record<string, string> | undefined, k: string) =>
        Number(r?.[k] || 0) || 0;

      const mmLong = num(latest, 'm_money_positions_long_all');
      const mmShort = num(latest, 'm_money_positions_short_all');
      const mmNet = mmLong - mmShort;
      const prevMmNet = prev
        ? num(prev, 'm_money_positions_long_all') - num(prev, 'm_money_positions_short_all')
        : mmNet;
      const mmChange = mmNet - prevMmNet;

      const commNet =
        num(latest, 'prod_merc_positions_long') - num(latest, 'prod_merc_positions_short');
      const swapNet =
        num(latest, 'swap_positions_long_all') - num(latest, 'swap__positions_short_all');
      const retailNet =
        num(latest, 'nonrept_positions_long_all') - num(latest, 'nonrept_positions_short_all');
      const oi = num(latest, 'open_interest_all');

      let bias: CotPositioning['bias'] = 'NEUTRAL';
      if (mmNet > 40_000 && mmChange >= -5_000) bias = 'BULLISH';
      else if (mmNet < 10_000 || mmChange <= -15_000) bias = 'BEARISH';

      this.cotPositioning = {
        marketName: latest.market_and_exchange_names || 'COMEX GOLD',
        reportDate: (latest.report_date_as_yyyy_mm_dd || '').slice(0, 10),
        openInterest: oi,
        managedMoneyLong: mmLong,
        managedMoneyShort: mmShort,
        managedMoneyNet: mmNet,
        managedMoneyNetChange: mmChange,
        commercialNet: commNet,
        swapDealerNet: swapNet,
        retailNet,
        bias,
      };
    } catch {
      // Ignore transient CFTC errors
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
      dataSource?: string;
      feedStatus: 'LIVE' | 'FALLBACK';
    },
  ) {
    const inst = this.instruments.get(symbol);
    const seed = this.seeds.get(symbol);
    if (!inst || !seed || !Number.isFinite(opts.price) || opts.price <= 0) return;
    if (opts.feedStatus === 'LIVE') this.lastLiveQuoteAt.set(symbol, Date.now());
    if (opts.dataSource) inst.dataSource = opts.dataSource;

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
    } else if ((symbol === 'XAU/USD' || symbol === 'GC1!') && this.goldL2Raw.bids.length > 0 && this.goldL2Raw.asks.length > 0) {
      const aligned = this.buildGoldCompactBook(bid, ask, seed.decimals);
      inst.bids = aligned.bids;
      inst.asks = aligned.asks;
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

  private async refreshMt5Candles() {
    if (!this.broker.isMt5Configured()) return;
    await Promise.all([
      this.fetchLiveCandles('XAU/USD', '5m').catch(() => {}),
      this.fetchLiveCandles('XAU/USD', '15m').catch(() => {}),
      this.fetchLiveCandles('XAU/USD', '1H').catch(() => {}),
    ]);
  }

  private async pollMt5Tick() {
    if (this.mt5QuoteInFlight || !this.broker.isMt5Configured()) return;
    this.mt5QuoteInFlight = true;
    try {
      const q = await this.broker.fetchMt5Quote();
      const xau = this.instruments.get('XAU/USD');
      const seed = this.seeds.get('XAU/USD');
      if (!q) {
        if (this.mt5HadLiveFeed && Date.now() - this.mt5LastLiveAt > 5000 && xau && seed) {
          this.mt5HadLiveFeed = false;
          xau.dataSource = seed.dataSourceLabel;
        }
        return;
      }

      const firstConnect = !this.mt5HadLiveFeed;
      const now = Date.now();
      this.mt5HadLiveFeed = true;
      this.mt5LastLiveAt = now;

      const changed = !xau || Math.abs(xau.bid - q.bid) >= 0.005 || Math.abs(xau.ask - q.ask) >= 0.005;
      const mid = (q.bid + q.ask) / 2;
      this.applyQuoteUpdate('XAU/USD', {
        price: mid,
        bid: q.bid,
        ask: q.ask,
        dataSource: 'MT5 Live Broker',
        feedStatus: 'LIVE',
      });

      if (firstConnect) {
        for (const key of Array.from(this.candleFetchedAt.keys())) {
          if (key.startsWith('XAU/USD:')) this.candleFetchedAt.delete(key);
        }
        void this.refreshMt5Candles();
      }

      if (changed || firstConnect || now - this.mt5LastBroadcastAt >= 1000) {
        this.mt5LastBroadcastAt = now;
        try {
          this.evaluateServerBotTick();
        } catch (err) {
          console.error('[bot] evaluateServerBotTick error:', err);
        }
        this.broadcastTick();
      }
    } finally {
      this.mt5QuoteInFlight = false;
    }
  }

  private async pollSwissquoteAndKraken() {
    if (this.swissquoteInFlight) return;
    this.swissquoteInFlight = true;
    try {
      const swissSeeds = SEEDS.filter((s) => s.swissquotePair);
    await Promise.all([
      ...swissSeeds.map(async (seed) => {
        if (seed.symbol === 'XAU/USD' && Date.now() - this.mt5LastLiveAt < 5000) {
          return;
        }
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
            dataSource: seed.dataSourceLabel,
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
            `https://api.kraken.com/0/public/Depth?pair=${krakenSeed.krakenPair}&count=40`,
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
          this.btcL2Raw = {
            bids: d.bids.map(([p, sz]) => ({price: parseFloat(p), size: parseFloat(sz) || 0})).filter((x) => x.price > 0 && x.size > 0),
            asks: d.asks.map(([p, sz]) => ({price: parseFloat(p), size: parseFloat(sz) || 0})).filter((x) => x.price > 0 && x.size > 0),
            updatedAt: Date.now(),
          };
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
      // Real executed Gold Order Flow & Multi-Venue L2 DOM (Kraken PAXG/USD + Binance PAXGUSDT + Coinbase PAXG-USD)
      (async () => {
        const fetchCoinbase = Date.now() - this.coinbaseLastPollAt >= 4000;
        if (fetchCoinbase) this.coinbaseLastPollAt = Date.now();
        const [paxgTrades, paxgDepth, binanceDepth, coinbaseBook] = await Promise.all([
          fetchJsonWithTimeout<KrakenTradesResponse>(
            'https://api.kraken.com/0/public/Trades?pair=PAXGUSD&count=60',
            3500,
          ),
          fetchJsonWithTimeout<KrakenDepthResponse>(
            'https://api.kraken.com/0/public/Depth?pair=PAXGUSD&count=25',
            3500,
          ),
          fetchJsonWithTimeout<BinanceDepthResponse>(
            'https://api.binance.com/api/v3/depth?symbol=PAXGUSDT&limit=50',
            3200,
          ),
          fetchCoinbase
            ? fetchJsonWithTimeout<CoinbaseBookResponse>(
                'https://api.exchange.coinbase.com/products/PAXG-USD/book?level=2',
                3500,
              )
            : Promise.resolve(null),
        ]);

        const trKey = paxgTrades?.result
          ? Object.keys(paxgTrades.result).find((k) => k !== 'last')
          : undefined;
        const rows = trKey ? paxgTrades?.result?.[trKey] : undefined;
        if (rows && rows.length > 0) {
          let buyOz = 0;
          let sellOz = 0;
          let latestPx = this.instFlow.paxgPrice;
          const large: typeof this.instFlow.paxgLargePrints = [];

          for (const row of rows.slice(-60)) {
            const px = parseFloat(row[0]);
            const sz = parseFloat(row[1]);
            const ts = Math.round(row[2] * 1000);
            const side: OrderSide = row[3] === 'b' ? 'BUY' : 'SELL';
            if (!Number.isFinite(px) || !Number.isFinite(sz)) continue;
            latestPx = roundToDecimals(px, 2);
            if (side === 'BUY') buyOz += sz;
            else sellOz += sz;
            if (sz >= 0.2) {
              large.push({
                id: `paxg-${ts}-${Math.round(sz * 1000)}`,
                price: latestPx,
                sizeOz: Number(sz.toFixed(3)),
                side,
                timestamp: ts,
              });
            }
          }

          const totalOz = buyOz + sellOz;
          this.instFlow.paxgPrice = latestPx;
          this.instFlow.paxgBuyVolumeOz = Number(buyOz.toFixed(2));
          this.instFlow.paxgSellVolumeOz = Number(sellOz.toFixed(2));
          this.instFlow.paxgNetDeltaOz = Number((buyOz - sellOz).toFixed(2));
          this.instFlow.paxgBuyPct = totalOz > 0 ? Math.round((buyOz / totalOz) * 100) : 50;
          this.instFlow.paxgLargePrints = large.reverse().slice(0, 8);
          this.instFlow.updatedAt = Date.now();
        }

        const mergedBids: Array<{offset: number; size: number; venue: string}> = [];
        const mergedAsks: Array<{offset: number; size: number; venue: string}> = [];
        const activeVenues: string[] = [];

        const dKey = paxgDepth?.result ? Object.keys(paxgDepth.result)[0] : undefined;
        const kDepth = dKey ? paxgDepth?.result?.[dKey] : undefined;
        if (kDepth?.bids?.length && kDepth?.asks?.length) {
          const kb0 = parseFloat(kDepth.bids[0][0]);
          const ka0 = parseFloat(kDepth.asks[0][0]);
          const kMid = (kb0 + ka0) / 2;
          if (kMid > 0) {
            activeVenues.push('Kraken');
            for (const [p, s] of kDepth.bids) {
              const offset = parseFloat(p) - kMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedBids.push({offset, size, venue: 'Kraken'});
            }
            for (const [p, s] of kDepth.asks) {
              const offset = parseFloat(p) - kMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedAsks.push({offset, size, venue: 'Kraken'});
            }
          }
          const bidSum = kDepth.bids.slice(0, 12).reduce((a, r) => a + (parseFloat(r[1]) || 0), 0);
          const askSum = kDepth.asks.slice(0, 12).reduce((a, r) => a + (parseFloat(r[1]) || 0), 0);
          const tot = bidSum + askSum;
          if (tot > 0) {
            this.instFlow.paxgBookBidPct = Math.round((bidSum / tot) * 100);
            this.instFlow.updatedAt = Date.now();
          }
        }

        if (binanceDepth?.bids?.length && binanceDepth?.asks?.length) {
          const bb0 = parseFloat(binanceDepth.bids[0][0]);
          const ba0 = parseFloat(binanceDepth.asks[0][0]);
          const bMid = (bb0 + ba0) / 2;
          if (bMid > 0) {
            activeVenues.push('Binance');
            for (const [p, s] of binanceDepth.bids) {
              const offset = parseFloat(p) - bMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedBids.push({offset, size, venue: 'Binance'});
            }
            for (const [p, s] of binanceDepth.asks) {
              const offset = parseFloat(p) - bMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedAsks.push({offset, size, venue: 'Binance'});
            }
          }
        }

        if (coinbaseBook?.bids?.length && coinbaseBook?.asks?.length) {
          const cb0 = parseFloat(coinbaseBook.bids[0][0]);
          const ca0 = parseFloat(coinbaseBook.asks[0][0]);
          const cMid = (cb0 + ca0) / 2;
          if (cMid > 0) {
            activeVenues.push('Coinbase');
            for (const [p, s] of coinbaseBook.bids.slice(0, 50)) {
              const offset = parseFloat(p) - cMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedBids.push({offset, size, venue: 'Coinbase'});
            }
            for (const [p, s] of coinbaseBook.asks.slice(0, 50)) {
              const offset = parseFloat(p) - cMid;
              const size = parseFloat(s);
              if (Math.abs(offset) <= 45 && size > 0) mergedAsks.push({offset, size, venue: 'Coinbase'});
            }
          }
        } else if (!fetchCoinbase && this.goldL2Raw.venues.includes('Coinbase')) {
          // Preserve Coinbase deep resting liquidity between 4s polls
          for (const b of this.goldL2Raw.bids) {
            if (b.venue === 'Coinbase') mergedBids.push(b);
          }
          for (const a of this.goldL2Raw.asks) {
            if (a.venue === 'Coinbase') mergedAsks.push(a);
          }
          activeVenues.push('Coinbase');
        }

        if (mergedBids.length > 0 && mergedAsks.length > 0) {
          this.goldL2Raw = {
            bids: mergedBids,
            asks: mergedAsks,
            venues: Array.from(new Set(activeVenues)),
            updatedAt: Date.now(),
          };
          const xauInst = this.instruments.get('XAU/USD');
          if (xauInst) {
            const aligned = this.buildGoldCompactBook(xauInst.bid, xauInst.ask, xauInst.decimals);
            xauInst.bids = aligned.bids;
            xauInst.asks = aligned.asks;
            const top5Bid = aligned.bids.slice(0, 5).reduce((s, l) => s + l.size, 0);
            const top5Ask = aligned.asks.slice(0, 5).reduce((s, l) => s + l.size, 0);
            const nowTs = Date.now();
            this.goldL2History = [
              ...this.goldL2History.filter((h) => nowTs - h.ts <= 30_000),
              {ts: nowTs, top5Bid: Number(top5Bid.toFixed(2)), top5Ask: Number(top5Ask.toFixed(2))},
            ].slice(-18);
          }
        }
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

    const tfMap = this.candleCache.get('XAU/USD');
    const c15 = tfMap?.get('15m') || [];
    const c1h = tfMap?.get('1H') || [];
    const c5 = tfMap?.get('5m') || [];
    const bars = c5.length >= 22 ? c5 : c15;
    const macro = this.getGoldMacro();
    const prints = this.recentPrints.get('XAU/USD') || [];
    const buyPrints = prints.filter((p) => p.side === 'BUY').length;
    const buyPct = prints.length > 0 ? Math.round((buyPrints / prints.length) * 100) : 50;
    const mtfBull =
      c15.length >= 22 && c1h.length >= 22
        ? serverEmaLast(c15, 9) > serverEmaLast(c15, 21) &&
          serverEmaLast(c1h, 9) > serverEmaLast(c1h, 21)
        : null;
    const mtfBear =
      c15.length >= 22 && c1h.length >= 22
        ? serverEmaLast(c15, 9) < serverEmaLast(c15, 21) &&
          serverEmaLast(c1h, 9) < serverEmaLast(c1h, 21)
        : null;

    let anyClosedThisTick = false;

    // 1. Manage open 24/7 Server Bot positions (Trailing Stop, Auto BE, Partial TP, Early Exit, SL/TP)
    for (const pos of this.serverBot.positions) {
      const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
      let cur = {...pos};

      if (cur.trailingStopDistance && cur.trailingStopDistance > 0) {
        if (cur.side === 'BUY' && exitMark > cur.peakFavorablePrice) {
          const prevSl = cur.stopLoss ?? 0;
          const sl = roundToDecimals(exitMark - cur.trailingStopDistance, 2);
          cur.peakFavorablePrice = exitMark;
          cur.stopLoss = cur.stopLoss ? Math.max(cur.stopLoss, sl) : sl;
          stateDirty = true;
          if (Math.abs(cur.stopLoss - prevSl) >= 0.25) {
            void this.broker.routeBrokerModifyRisk(cur, cur.stopLoss, cur.takeProfit);
          }
        } else if (cur.side === 'SELL' && exitMark < cur.peakFavorablePrice) {
          const prevSl = cur.stopLoss ?? 999_999;
          const sl = roundToDecimals(exitMark + cur.trailingStopDistance, 2);
          cur.peakFavorablePrice = exitMark;
          cur.stopLoss = cur.stopLoss ? Math.min(cur.stopLoss, sl) : sl;
          stateDirty = true;
          if (Math.abs(cur.stopLoss - prevSl) >= 0.25) {
            void this.broker.routeBrokerModifyRisk(cur, cur.stopLoss, cur.takeProfit);
          }
        }
      }

      if (cur.takeProfit !== null) {
        const tpDist = Math.abs(cur.takeProfit - cur.entryPrice);
        const fav = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;

        if ((cfg.autoBreakEvenEnabled ?? true) && !cur.breakEvenMoved && tpDist > 0 && fav >= tpDist * 0.5) {
          const be = roundToDecimals(cur.side === 'BUY' ? cur.entryPrice + 0.45 : cur.entryPrice - 0.45, 2);
          cur.stopLoss =
            cur.side === 'BUY'
              ? cur.stopLoss !== null ? Math.max(cur.stopLoss, be) : be
              : cur.stopLoss !== null ? Math.min(cur.stopLoss, be) : be;
          cur.breakEvenMoved = true;
          stateDirty = true;
          if (Math.abs(exitMark - cur.stopLoss) >= 0.5) {
            void this.broker.routeBrokerModifyRisk(cur, cur.stopLoss, cur.takeProfit);
          }
          this.appendServerBotLog('RISK', `Auto BE locked SL @ ${cur.stopLoss.toFixed(2)}`);
        }

        if ((cfg.partialTpEnabled ?? true) && !cur.partialTpTaken && cur.quantity >= 0.04 && tpDist > 0 && fav >= tpDist * 0.7) {
          const closeQty = roundToDecimals(cur.quantity * 0.5, 2);
          const remQty = roundToDecimals(cur.quantity - closeQty, 2);
          if (closeQty > 0 && remQty > 0) {
            const diff = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;
            const gross = roundToDecimals(diff * closeQty * xau.contractSize, 2);
            const commissionFee = roundToDecimals(closeQty * xau.commissionPerUnit * 2, 2);
            const swapPnl = computeOvernightSwapPnl(
              cur.side,
              closeQty,
              cur.openedAt,
              now,
              xau.overnightSwapLong,
              xau.overnightSwapShort,
            );
            const fee = roundToDecimals(commissionFee + Math.max(0, -swapPnl), 2);
            const net = roundToDecimals(gross - commissionFee + swapPnl, 2);
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
            anyClosedThisTick = true;
            void this.broker.routeBrokerCloseOrder(pos, 0.5);
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

      // Time-Stop / Early Exit if trade stagnates in loss and MTF + Order Flow both flipped against it
      const staleMin = cfg.staleTradeMinutes ?? 45;
      if (!hitAction && staleMin > 0 && now - cur.openedAt >= staleMin * 60_000) {
        const unrealDiff = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;
        if (unrealDiff < 0) {
          const flippedBear = cur.side === 'BUY' && mtfBear === true && buyPct <= 42;
          const flippedBull = cur.side === 'SELL' && mtfBull === true && buyPct >= 58;
          if (flippedBear || flippedBull) {
            hitAction = 'EARLY_EXIT';
          }
        }
      }

      if (hitAction) {
        void this.broker.routeBrokerCloseOrder(cur, 1);
        const diff = cur.side === 'BUY' ? exitMark - cur.entryPrice : cur.entryPrice - exitMark;
        const gross = roundToDecimals(diff * cur.quantity * xau.contractSize, 2);
        const commissionFee = roundToDecimals(cur.quantity * xau.commissionPerUnit * 2, 2);
        const swapPnl = computeOvernightSwapPnl(
          cur.side,
          cur.quantity,
          cur.openedAt,
          now,
          xau.overnightSwapLong,
          xau.overnightSwapShort,
        );
        const fee = roundToDecimals(commissionFee + Math.max(0, -swapPnl), 2);
        const net = roundToDecimals(gross - commissionFee + swapPnl, 2);
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
        anyClosedThisTick = true;
        stateDirty = true;
      } else {
        remaining.push(cur);
      }
    }
    this.serverBot.positions = remaining;

    if (anyClosedThisTick && (cfg.autoLearnEnabled ?? true)) {
      const adapted = serverAdaptConfig(this.serverBot.config, this.serverBot.closedTrades);
      if (adapted.summary) {
        this.serverBot.config = adapted.nextConfig;
        this.appendServerBotLog('LEARN', `Auto-Learn tuned: ${adapted.summary}`);
        stateDirty = true;
      }
    }

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

    // 3. Evaluate Entry Signals (Multi-Strategy + Regime + ATAS + MTF + Macro + Institutional + Guards)
    const activeCfg = this.serverBot.config;
    const maxTrades = Math.max(1, Math.min(10, Math.round(activeCfg.maxConcurrentPositions || 3)));
    const cooldownMs = Math.max(5, activeCfg.cooldownSeconds || 25) * 1000;
    if (
      this.serverBot.positions.length < maxTrades &&
      now - this.serverBotLastTradeAt >= cooldownMs &&
      bars.length >= 22
    ) {
      const spread = roundToDecimals(Math.max(0, xau.ask - xau.bid), 2);
      const cal = this.getEconomicCalendar(activeCfg.newsPauseMinutesBefore ?? 15, activeCfg.newsPauseMinutesAfter ?? 15);

      // Anti-Tilt Loss-Streak Cooldown Check
      const sortedClosed = [...this.serverBot.closedTrades].sort((a, b) => b.closedAt - a.closedAt);
      let trailingLosses = 0;
      for (const t of sortedClosed) {
        if (t.netPnl < 0) trailingLosses += 1;
        else break;
      }
      const antiTiltMs = Math.max(0, activeCfg.antiTiltCooldownMinutes ?? 15) * 60_000;
      const antiTiltBlocked =
        trailingLosses >= 2 &&
        sortedClosed[0] &&
        now - sortedClosed[0].closedAt < antiTiltMs;

      const lastLiveAt = this.lastLiveQuoteAt.get('XAU/USD') ?? 0;
      if (isQuoteStale(lastLiveAt, now)) {
        if (now - this.serverBotLastHoldLogAt >= 30_000) {
          this.serverBotLastHoldLogAt = now;
          this.appendServerBotLog(
            'RISK',
            lastLiveAt > 0
              ? `Stale Data Guard paused: no live XAU/USD quote for ${Math.round((now - lastLiveAt) / 1000)}s.`
              : 'Stale Data Guard paused: no live XAU/USD quote received yet.',
          );
        }
      } else if ((activeCfg.useNewsGuard ?? true) && cal.newsGuardActive) {
        if (now - this.serverBotLastHoldLogAt >= 30_000) {
          this.serverBotLastHoldLogAt = now;
          this.appendServerBotLog('RISK', `News Guard paused: ${cal.activeGuardEvent?.title}`);
        }
      } else if ((activeCfg.useSessionSpreadGuard ?? true) && spread > (activeCfg.maxSpreadDollars ?? 1.2)) {
        if (now - this.serverBotLastHoldLogAt >= 30_000) {
          this.serverBotLastHoldLogAt = now;
          this.appendServerBotLog('RISK', `Spread Guard paused: $${spread.toFixed(2)}/oz`);
        }
      } else if ((activeCfg.useKillzonesOnly ?? false) && !serverInKillzone(now)) {
        if (now - this.serverBotLastHoldLogAt >= 60_000) {
          this.serverBotLastHoldLogAt = now;
          this.appendServerBotLog('RISK', 'Killzone Guard: outside London/NY Prime hours');
        }
      } else if (antiTiltBlocked) {
        if (now - this.serverBotLastHoldLogAt >= 60_000) {
          this.serverBotLastHoldLogAt = now;
          this.appendServerBotLog('RISK', `Anti-Tilt cooldown active after ${trailingLosses} consecutive losses`);
        }
      } else {
        const ema9 = serverEmaLast(bars, 9);
        const prevEma9 = serverEmaPrev(bars, 9);
        const ema21 = serverEmaLast(bars, 21);
        const prevEma21 = serverEmaPrev(bars, 21);
        const rsi = serverRsiLast(bars, 14);
        const vwap = serverVwapLast(bars);
        const atr14 = serverAtr14(bars);
        const bb = serverBollingerLast(bars, 20);
        const regime = serverDetectRegime(bars, ema9, ema21, bb.upper, bb.lower, rsi, atr14);
        const atas = serverAtasBarSignals(bars);
        const vp = computeServerVolumeProfile(bars, xau.tickSize);

        // Session-anchored Opening Range (London / NY / UTC midnight)
        const orbRange = computeSessionOrbRange(bars, 15);
        const orHigh = orbRange.orHigh > 0 ? orbRange.orHigh : xau.price + 5;
        const orLow = orbRange.orLow > 0 ? orbRange.orLow : xau.price - 5;

        const evalSub = (strat: Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>): {action: 'BUY' | 'SELL' | 'HOLD'; conf: number} => {
          if (strat === 'ORB_VWAP') {
            if (xau.price > orHigh && xau.price >= vwap && rsi >= 50 && rsi <= 74) return {action: 'BUY', conf: 72};
            if (xau.price < orLow && xau.price <= vwap && rsi <= 50 && rsi >= 26) return {action: 'SELL', conf: 72};
            return {action: 'HOLD', conf: 42};
          }
          if (strat === 'EMA_MOMENTUM') {
            const bullCross = prevEma9 <= prevEma21 && ema9 > ema21;
            const bearCross = prevEma9 >= prevEma21 && ema9 < ema21;
            if (bullCross || (ema9 > ema21 && xau.price > vwap && rsi >= 52 && rsi <= 72)) {
              return {action: 'BUY', conf: bullCross ? 84 : 68};
            }
            if (bearCross || (ema9 < ema21 && xau.price < vwap && rsi <= 48 && rsi >= 28)) {
              return {action: 'SELL', conf: bearCross ? 84 : 68};
            }
            return {action: 'HOLD', conf: 42};
          }
          if (strat === 'BOLLINGER_REVERSION') {
            if (xau.price <= bb.lower && rsi <= 36) return {action: 'BUY', conf: 78};
            if (xau.price >= bb.upper && rsi >= 64) return {action: 'SELL', conf: 78};
            return {action: 'HOLD', conf: 44};
          }
          if (strat === 'ORDERFLOW_LIQUIDITY') {
            const nearSupport = xau.price >= vp.val - atr14 * 0.4 && xau.price <= vp.poc + atr14 * 0.6;
            const nearResistance = xau.price <= vp.vah + atr14 * 0.4 && xau.price >= vp.poc - atr14 * 0.6;
            if (buyPct >= 56 && xau.price >= vwap && (nearSupport || xau.price > vp.poc)) return {action: 'BUY', conf: 74};
            if (buyPct <= 44 && xau.price <= vwap && (nearResistance || xau.price < vp.poc)) return {action: 'SELL', conf: 74};
            return {action: 'HOLD', conf: 45};
          }
          // LIQUIDITY_SWEEP_SMC
          const lookback = bars.slice(-26, -2);
          if (lookback.length >= 10) {
            const swHigh = Math.max(...lookback.map((b) => b.high));
            const swLow = Math.min(...lookback.map((b) => b.low));
            const last = bars[bars.length - 1];
            const prev = bars[bars.length - 2];
            const minLow = Math.min(last.low, prev.low);
            const maxHigh = Math.max(last.high, prev.high);
            if (minLow < swLow - atr14 * 0.08 && last.close > swLow && last.close > last.open) {
              return {action: 'BUY', conf: atas.absorption === 'BULLISH_ABSORPTION' || atas.cvdDivergence === 'BULLISH' ? 84 : 74};
            }
            if (maxHigh > swHigh + atr14 * 0.08 && last.close < swHigh && last.close < last.open) {
              return {action: 'SELL', conf: atas.absorption === 'BEARISH_ABSORPTION' || atas.cvdDivergence === 'BEARISH' ? 84 : 74};
            }
          }
          return {action: 'HOLD', conf: 42};
        };

        let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
        let conf = 45;
        let usedSubStrategy: XauBotStrategy = activeCfg.strategy;

        if (activeCfg.strategy === 'SMART_ENSEMBLE') {
          const subs: Array<Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>> = [
            'ORB_VWAP',
            'LIQUIDITY_SWEEP_SMC',
            'ORDERFLOW_LIQUIDITY',
            'EMA_MOMENTUM',
            'BOLLINGER_REVERSION',
          ];
          const regimeAdj = (s: Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>) => {
            if (regime === 'TRENDING') return s === 'EMA_MOMENTUM' || s === 'ORB_VWAP' ? 8 : s === 'BOLLINGER_REVERSION' ? -8 : 0;
            if (regime === 'BREAKOUT') return s === 'ORB_VWAP' || s === 'ORDERFLOW_LIQUIDITY' ? 8 : s === 'BOLLINGER_REVERSION' ? -6 : 0;
            if (regime === 'RANGING') return s === 'BOLLINGER_REVERSION' || s === 'ORDERFLOW_LIQUIDITY' ? 8 : s === 'EMA_MOMENTUM' ? -6 : 0;
            return s === 'LIQUIDITY_SWEEP_SMC' || s === 'BOLLINGER_REVERSION' ? 9 : -3;
          };
          const res = subs.map((s) => {
            const r = evalSub(s);
            return {s, action: r.action, wConf: r.action === 'HOLD' ? r.conf : Math.max(20, Math.min(96, r.conf + regimeAdj(s)))};
          });
          const buys = res.filter((r) => r.action === 'BUY').sort((a, b) => b.wConf - a.wConf);
          const sells = res.filter((r) => r.action === 'SELL').sort((a, b) => b.wConf - a.wConf);
          if (buys.length > sells.length && buys.length > 0) {
            action = 'BUY';
            usedSubStrategy = buys[0].s;
            conf = buys[0].wConf + (buys.length >= 2 ? Math.min(10, (buys.length - 1) * 5) : 0) - sells.length * 6;
          } else if (sells.length > buys.length && sells.length > 0) {
            action = 'SELL';
            usedSubStrategy = sells[0].s;
            conf = sells[0].wConf + (sells.length >= 2 ? Math.min(10, (sells.length - 1) * 5) : 0) - buys.length * 6;
          }
        } else {
          const single = evalSub(activeCfg.strategy);
          action = single.action;
          conf = single.conf;
        }

        if (action !== 'HOLD' && (activeCfg.useOrderFlowConfluence ?? true)) {
          if (prints.length >= 4) {
            if (action === 'BUY' && buyPct >= 56) conf += 8;
            else if (action === 'BUY' && buyPct <= 40) conf -= 14;
            else if (action === 'SELL' && buyPct <= 44) conf += 8;
            else if (action === 'SELL' && buyPct >= 60) conf -= 14;
          }
          if ((action === 'BUY' && vp.stackedImbalance === 'BULLISH_STACK') || (action === 'SELL' && vp.stackedImbalance === 'BEARISH_STACK')) {
            conf += 4;
          } else if ((action === 'BUY' && vp.stackedImbalance === 'BEARISH_STACK') || (action === 'SELL' && vp.stackedImbalance === 'BULLISH_STACK')) {
            conf -= 8;
          }
          if ((action === 'BUY' && (atas.absorption === 'BULLISH_ABSORPTION' || atas.cvdDivergence === 'BULLISH')) ||
              (action === 'SELL' && (atas.absorption === 'BEARISH_ABSORPTION' || atas.cvdDivergence === 'BEARISH'))) {
            conf += 4;
          } else if ((action === 'BUY' && (atas.absorption === 'BEARISH_ABSORPTION' || atas.cvdDivergence === 'BEARISH')) ||
                     (action === 'SELL' && (atas.absorption === 'BULLISH_ABSORPTION' || atas.cvdDivergence === 'BULLISH'))) {
            conf -= 6;
          }
        }

        if (action !== 'HOLD' && (activeCfg.useMtfConfluence ?? true) && mtfBull !== null && mtfBear !== null) {
          if ((action === 'BUY' && mtfBull) || (action === 'SELL' && mtfBear)) conf += 9;
          else if ((action === 'BUY' && mtfBear) || (action === 'SELL' && mtfBull)) conf -= 16;
        }

        if (action !== 'HOLD' && (activeCfg.useMacroConfluence ?? true)) {
          if ((action === 'BUY' && macro.macroBias === 'BULLISH') || (action === 'SELL' && macro.macroBias === 'BEARISH')) conf += 6;
          else if ((action === 'BUY' && macro.macroBias === 'BEARISH') || (action === 'SELL' && macro.macroBias === 'BULLISH')) conf -= 8;
        }

        // Pro Trader Discipline: VWAP Overextension & PDH/PDL Exhaustion Guard
        if (action !== 'HOLD') {
          if (action === 'BUY' && xau.price - vwap >= atr14 * 2.1) {
            conf -= 8; // Refuse chasing stretched tops far above VWAP
          } else if (action === 'SELL' && vwap - xau.price >= atr14 * 2.1) {
            conf -= 8; // Refuse chasing stretched bottoms far below VWAP
          }
          if (xau.high24h > xau.low24h) {
            if (action === 'BUY' && Math.abs(xau.high24h - xau.price) <= 1.2 && vp.stackedImbalance !== 'BULLISH_STACK') {
              conf -= 5; // Chasing right into PDH without stacked buyers
            } else if (action === 'SELL' && Math.abs(xau.price - xau.low24h) <= 1.2 && vp.stackedImbalance !== 'BEARISH_STACK') {
              conf -= 5; // Chasing right into PDL without stacked sellers
            }
          }
        }

        // Institutional Gold Flow, Multi-Venue L2 Microprice, Spoof Pulling/Stacking, Futures OI, Real Yields & Silver SMT
        const instCtx = this.getInstitutionalGold();
        if (action !== 'HOLD' && (activeCfg.useOrderFlowConfluence ?? true)) {
          if (action === 'BUY' && instCtx.paxgBuyPct >= 58 && instCtx.paxgBookBidPct >= 52) conf += 6;
          else if (action === 'BUY' && instCtx.paxgBuyPct <= 38 && instCtx.paxgBookBidPct <= 44) conf -= 9;
          else if (action === 'SELL' && instCtx.paxgBuyPct <= 42 && instCtx.paxgBookBidPct <= 48) conf += 6;
          else if (action === 'SELL' && instCtx.paxgBuyPct >= 62 && instCtx.paxgBookBidPct >= 56) conf -= 9;

          if (typeof instCtx.l2Top5BidPct === 'number' && typeof instCtx.l2MicroTiltDollars === 'number') {
            if (action === 'BUY' && instCtx.l2Top5BidPct >= 60 && instCtx.l2MicroTiltDollars > 0) conf += 4;
            else if (action === 'SELL' && instCtx.l2Top5BidPct <= 40 && instCtx.l2MicroTiltDollars < 0) conf += 4;
            else if (
              (action === 'BUY' && instCtx.l2Top5BidPct <= 36 && (instCtx.l2FullBidPct ?? 50) <= 44) ||
              (action === 'SELL' && instCtx.l2Top5BidPct >= 64 && (instCtx.l2FullBidPct ?? 50) >= 56)
            ) {
              conf -= 7;
            }
          }

          // DOM Pulling vs. Stacking Spoof Detector
          const vel = instCtx.l2WallVelocity ?? 'BALANCED';
          if (action === 'BUY') {
            if (vel === 'PULLING_ASKS') {
              conf += 4; // Overhead ask wall pulled -> path cleared / spoof vanished
            } else {
              if (instCtx.l2NearestAskWall && instCtx.l2NearestAskWall.distanceDollars <= 1.5) conf -= 5;
              if (vel === 'STACKING_ASKS') conf -= 7;
              else if (vel === 'STACKING_BIDS') conf += 4;
              else if (vel === 'PULLING_BIDS') conf -= 5;
            }
          } else if (action === 'SELL') {
            if (vel === 'PULLING_BIDS') {
              conf += 4; // Underneath bid support pulled -> vacuum down
            } else {
              if (instCtx.l2NearestBidWall && instCtx.l2NearestBidWall.distanceDollars <= 1.5) conf -= 5;
              if (vel === 'STACKING_BIDS') conf -= 7;
              else if (vel === 'STACKING_ASKS') conf += 4;
              else if (vel === 'PULLING_ASKS') conf -= 5;
            }
          }

          // Binance PAXGUSDT Perpetual Futures OI Regime & Funding Extremes
          if (instCtx.futuresRegime === 'NEW_LONGS' && action === 'BUY') conf += 5;
          else if (instCtx.futuresRegime === 'NEW_SHORTS' && action === 'SELL') conf += 5;
          else if (instCtx.futuresRegime === 'SHORT_COVERING' && action === 'BUY') conf -= 7;
          else if (instCtx.futuresRegime === 'LONG_LIQUIDATION' && action === 'SELL') conf -= 7;

          if (typeof instCtx.futuresFundingRate === 'number') {
            if (action === 'BUY' && instCtx.futuresFundingRate >= 0.0005) conf -= 4;
            else if (action === 'SELL' && instCtx.futuresFundingRate <= -0.0005) conf -= 4;
          }
        }

        if (action !== 'HOLD' && (activeCfg.useMacroConfluence ?? true)) {
          if ((action === 'BUY' && instCtx.compositeBias === 'BULLISH') || (action === 'SELL' && instCtx.compositeBias === 'BEARISH')) conf += 4;
          else if ((action === 'BUY' && instCtx.compositeBias === 'BEARISH') || (action === 'SELL' && instCtx.compositeBias === 'BULLISH')) conf -= 4;

          // Silver vs Gold SMT Divergence
          if ((action === 'BUY' && instCtx.smtDivergence === 'BULLISH_SMT') || (action === 'SELL' && instCtx.smtDivergence === 'BEARISH_SMT')) {
            conf += 6;
          } else if ((action === 'BUY' && instCtx.smtDivergence === 'BEARISH_SMT') || (action === 'SELL' && instCtx.smtDivergence === 'BULLISH_SMT')) {
            conf -= 6;
          }

          // Real Yields (TIP) & Gold Miners (GDX)
          const tipUp = (instCtx.tipChangePct ?? 0) >= 0.12;
          const tipDn = (instCtx.tipChangePct ?? 0) <= -0.12;
          const gdxUp = (instCtx.gdxChangePct ?? 0) >= 0.25;
          const gdxDn = (instCtx.gdxChangePct ?? 0) <= -0.25;
          if (action === 'BUY') {
            if (tipUp && gdxUp) conf += 3;
            else if (tipDn && gdxDn) conf -= 4;
          } else if (action === 'SELL') {
            if (tipDn && gdxDn) conf += 3;
            else if (tipUp && gdxUp) conf -= 4;
          }
        }

        const effectiveMinConf = instCtx.volatilityAlert ? Math.min(90, activeCfg.minConfidence + 5) : activeCfg.minConfidence;

        if (action !== 'HOLD' && conf >= effectiveMinConf) {
          const fill = action === 'BUY' ? xau.ask : xau.bid;
          const sameSide = this.serverBot.positions.filter((p) => p.side === action);
          const closestDist = sameSide.length > 0 ? Math.min(...sameSide.map((p) => Math.abs(p.entryPrice - fill))) : 999;

          if (sameSide.length === 0 || closestDist >= 1.8 || (closestDist >= 0.9 && conf >= 80)) {
            const tierIdx = sameSide.length;
            const tpMult = roundToDecimals(1 + tierIdx * 0.35, 2);
            const effSl = (activeCfg.useAtrRiskScaling ?? true) && atr14 > 0
              ? Math.min(22, Math.max(activeCfg.stopLossDollars, roundToDecimals(atr14 * 1.25, 2)))
              : activeCfg.stopLossDollars;
            const effTp = Math.max(activeCfg.takeProfitDollars, roundToDecimals(effSl * 1.9, 2));

            // Dynamic Risk-% sizing + Anti-Tilt 50% recovery sizing after >=2 consecutive losses
            // Live routing sizes from the real account; the paper ledger is a simulated $100k base.
            const routedEquity = this.broker.shouldRouteRealBroker() ? this.broker.getRoutedEquity() ?? 0 : null;
            const serverEquity = routedEquity !== null
              ? Math.max(1, routedEquity)
              : Math.max(1000, 100_000 + this.serverBot.netPnl);
            const riskPct = activeCfg.riskPerTradePct ?? 0;
            let rawLot = riskPct > 0
              ? (serverEquity * (Math.min(5, riskPct) / 100)) / (effSl * 100)
              : activeCfg.lotSize;
            if (trailingLosses >= 2) rawLot *= trailingLosses >= 3 ? 0.5 : 0.65;
            const botLot = Math.max(0.01, Math.min(5.0, roundToDecimals(rawLot, 2)));

            // Live routing: hard risk limits (LIVE_* in .env) can shrink or veto the order.
            const liveRouting = this.broker.shouldRouteRealBroker();
            let liveBlocked = false;
            let effLot = botLot;
            if (liveRouting) {
              const openRisk = this.serverBot.positions.reduce((sum, p) => {
                const adverse = p.side === 'BUY' ? fill - (p.stopLoss ?? fill) : (p.stopLoss ?? fill) - fill;
                return sum + p.quantity * xau.contractSize * Math.max(0, p.stopLoss ? adverse : effSl);
              }, 0);
              const verdict = this.broker.evaluateLiveOrder({
                lot: botLot,
                stopLossDistance: effSl,
                contractSize: xau.contractSize,
                openRisk,
                openPositions: this.serverBot.positions.length,
              });
              if (verdict.allowed) {
                effLot = verdict.lot;
                if (verdict.limited) {
                  this.logLiveRisk(`Lot ${botLot} reduced to ${effLot} by live risk limits.`);
                }
              } else {
                liveBlocked = true;
                this.logLiveRisk(`${action} blocked by live risk limits: ${verdict.reason}.`);
              }
            }

            const sl = roundToDecimals(action === 'BUY' ? fill - effSl : fill + effSl, 2);
            const tp = roundToDecimals(action === 'BUY' ? fill + effTp * tpMult : fill - effTp * tpMult, 2);
            const trail = tierIdx > 0 ? activeCfg.trailingStopDollars ?? Math.max(4.5, roundToDecimals(effSl * 0.75, 2)) : activeCfg.trailingStopDollars;
            const fee = roundToDecimals(effLot * xau.commissionPerUnit, 2);

            if (liveBlocked) {
              // Nothing is sent to the broker; the reason was logged above.
            } else if (!this.brokerOrderInFlight && liveRouting) {
              this.brokerOrderInFlight = true;
              void this.broker.routeBrokerOpenOrder({
                side: action,
                lotSize: effLot,
                stopLoss: sl,
                takeProfit: tp,
                estimatedPrice: fill,
              }).then((brokerRes) => {
                this.brokerOrderInFlight = false;
                if (!brokerRes.ok) {
                  this.appendServerBotLog(
                    'RISK',
                    `Broker rejected ${action} ${effLot} XAU/USD: ${brokerRes.error || 'Unknown error'}`,
                  );
                  this.persistServerBotState();
                  return;
                }
                const actualFill = brokerRes.fillPrice || fill;
                const actualSl = roundToDecimals(action === 'BUY' ? actualFill - effSl : actualFill + effSl, 2);
                const actualTp = roundToDecimals(action === 'BUY' ? actualFill + effTp * tpMult : actualFill - effTp * tpMult, 2);
                const newPos: Position = {
                  id: `sbpos-${now}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: 'XAU/USD',
                  side: action,
                  quantity: effLot,
                  entryPrice: actualFill,
                  leverage: activeCfg.leverage,
                  marginUsed: roundToDecimals((actualFill * effLot * xau.contractSize) / activeCfg.leverage, 2),
                  stopLoss: actualSl,
                  takeProfit: actualTp,
                  trailingStopDistance: trail,
                  peakFavorablePrice: actualFill,
                  openedAt: now,
                  commissionPaid: fee,
                  source: 'XAU_BOT',
                  botStrategy: usedSubStrategy,
                  botConfidence: conf,
                  brokerOrderId: brokerRes.brokerTradeId,
                  brokerProvider: brokerRes.provider,
                };
                if (Math.abs(actualFill - fill) >= 0.05 && brokerRes.brokerTradeId) {
                  void this.broker.routeBrokerModifyRisk(newPos, actualSl, actualTp);
                }
                this.serverBot.positions = [newPos, ...this.serverBot.positions];
                this.serverBot.executions = [
                  {
                    id: `sbex-open-${now}-${Math.random().toString(36).slice(2, 5)}`,
                    symbol: 'XAU/USD',
                    side: action,
                    action: 'OPEN' as const,
                    quantity: effLot,
                    price: actualFill,
                    realizedPnl: 0,
                    fee,
                    timestamp: now,
                    source: 'XAU_BOT' as const,
                    notes: `${brokerRes.provider} #${brokerRes.brokerTradeId || 'LIVE'} (${usedSubStrategy})`,
                  },
                  ...this.serverBot.executions,
                ].slice(0, 200);
                this.serverBotLastTradeAt = now;
                this.appendServerBotLog(
                  'EXECUTION',
                  `[${brokerRes.provider}] Opened ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'} ${action} ${effLot} XAU/USD @ ${actualFill.toFixed(2)} [${regime} · ${usedSubStrategy}]`,
                );
                this.persistServerBotState();
              });
            } else if (!liveRouting) {
              const newPos: Position = {
                id: `sbpos-${now}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: 'XAU/USD',
                side: action,
                quantity: effLot,
                entryPrice: fill,
                leverage: activeCfg.leverage,
                marginUsed: roundToDecimals((fill * effLot * xau.contractSize) / activeCfg.leverage, 2),
                stopLoss: sl,
                takeProfit: tp,
                trailingStopDistance: trail,
                peakFavorablePrice: fill,
                openedAt: now,
                commissionPaid: fee,
                source: 'XAU_BOT',
                botStrategy: usedSubStrategy,
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
                  quantity: effLot,
                  price: fill,
                  realizedPnl: 0,
                  fee,
                  timestamp: now,
                  source: 'XAU_BOT' as const,
                  notes: `24/7 Server ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'} (${usedSubStrategy})`,
                },
                ...this.serverBot.executions,
              ].slice(0, 200);
              this.serverBotLastTradeAt = now;
              this.appendServerBotLog(
                'EXECUTION',
                `Opened ${tierIdx > 0 ? `Runner #${tierIdx + 1}` : 'Core #1'} ${action} ${effLot} XAU/USD @ ${fill.toFixed(2)} [${regime} · ${usedSubStrategy}] (SL ${sl.toFixed(2)} / TP ${tp.toFixed(2)})`,
              );
              stateDirty = true;
            }
          }
        }
      }
    }

    if (stateDirty) {
      this.persistServerBotState();
    }
  }


  resetServerBotState(): ServerBotState {
    if (this.serverBot.positions.length > 0) {
      for (const pos of this.serverBot.positions) {
        void this.broker.routeBrokerCloseOrder(pos, 1);
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

  getServerBotState(): ServerBotState {
    const pnl = this.computeServerBotPnl(this.instruments.get('XAU/USD'));
    return {
      ...this.serverBot,
      netPnl: pnl.total,
      dailyPnl: pnl.daily,
      brokerStatus: this.getBrokerStatus(),
      machineId: os.hostname(),
      bootId: SERVER_BOOT_ID,
      storagePersistent: HAS_PERSISTENT_VOLUME,
    };
  }

  private liveRiskLog = {message: '', at: 0};

  // The bot re-evaluates every few seconds; log a given message at most once per 5 minutes.
  private logLiveRisk(message: string) {
    const now = Date.now();
    if (message === this.liveRiskLog.message && now - this.liveRiskLog.at < 5 * 60_000) return;
    this.liveRiskLog = {message, at: now};
    this.appendServerBotLog('RISK', message);
    this.persistServerBotState();
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
        void this.broker.routeBrokerCloseOrder(pos, 1);
        const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
        const diff = pos.side === 'BUY' ? exitMark - pos.entryPrice : pos.entryPrice - exitMark;
        const gross = roundToDecimals(diff * pos.quantity * xau.contractSize, 2);
        const commissionFee = roundToDecimals(pos.quantity * xau.commissionPerUnit * 2, 2);
        const swapPnl = computeOvernightSwapPnl(
          pos.side,
          pos.quantity,
          pos.openedAt,
          now,
          xau.overnightSwapLong,
          xau.overnightSwapShort,
        );
        const fee = roundToDecimals(commissionFee + Math.max(0, -swapPnl), 2);
        const net = roundToDecimals(gross - commissionFee + swapPnl, 2);
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
    void this.broker.routeBrokerCloseOrder(pos, clampedFraction);
    const closeQty =
      clampedFraction >= 0.999
        ? pos.quantity
        : roundToDecimals(Math.max(0.01, pos.quantity * clampedFraction), 2);
    const actualFraction = Math.min(1, closeQty / pos.quantity);

    const exitMark = pos.side === 'BUY' ? xau.bid : xau.ask;
    const diff = pos.side === 'BUY' ? exitMark - pos.entryPrice : pos.entryPrice - exitMark;
    const gross = roundToDecimals(diff * closeQty * xau.contractSize, 2);
    const commissionFee = roundToDecimals(closeQty * xau.commissionPerUnit * 2, 2);
    const swapPnl = computeOvernightSwapPnl(
      pos.side,
      closeQty,
      pos.openedAt,
      now,
      xau.overnightSwapLong,
      xau.overnightSwapShort,
    );
    const fee = roundToDecimals(commissionFee + Math.max(0, -swapPnl), 2);
    const net = roundToDecimals(gross - commissionFee + swapPnl, 2);
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
    void this.broker.routeBrokerModifyRisk(pos, stopLoss, takeProfit);
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
      // Institutional Cross-Assets (^GVZ, ^VIX, GLD, TIP, GDX, USDJPY=X, SI=F) & Binance PAXGUSDT Perp OI/Funding (throttled ~12s)
      (async () => {
        const nowTs = Date.now();
        if (nowTs - this.instFlowLastPollAt < 12_000) return;
        this.instFlowLastPollAt = nowTs;
        const fetchSilverBars = nowTs - this.silverBarsLastPollAt >= 30_000 || this.silver5mCandles.length === 0;
        if (fetchSilverBars) this.silverBarsLastPollAt = nowTs;

        const [gvzRes, vixRes, gldRes, tipRes, gdxRes, jpyRes, siRes, oiRes, premRes, takerRes] = await Promise.all([
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/%5EGVZ?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/GLD?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/TIP?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/GDX?range=1d&interval=5m',
            4500,
          ),
          fetchJsonWithTimeout<YahooChartResponse>(
            'https://query1.finance.yahoo.com/v8/finance/chart/USDJPY%3DX?range=1d&interval=5m',
            4500,
          ),
          fetchSilverBars
            ? fetchJsonWithTimeout<YahooChartResponse>(
                'https://query1.finance.yahoo.com/v8/finance/chart/SI%3DF?range=1d&interval=5m',
                4500,
              )
            : Promise.resolve(null),
          fetchJsonWithTimeout<BinanceOpenInterestResponse>(
            'https://fapi.binance.com/fapi/v1/openInterest?symbol=PAXGUSDT',
            3500,
          ),
          fetchJsonWithTimeout<BinancePremiumIndexResponse>(
            'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=PAXGUSDT',
            3500,
          ),
          fetchJsonWithTimeout<BinanceTakerRatioRow[]>(
            'https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=PAXGUSDT&period=5m&limit=3',
            3500,
          ),
        ]);

        const gvzMeta = gvzRes?.chart?.result?.[0]?.meta;
        if (gvzMeta?.regularMarketPrice) {
          const prev = gvzMeta.chartPreviousClose || gvzMeta.previousClose || gvzMeta.regularMarketPrice;
          this.instFlow.gvz = roundToDecimals(gvzMeta.regularMarketPrice, 2);
          this.instFlow.gvzChangePct = prev > 0 ? roundToDecimals(((gvzMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
        }
        const vixMeta = vixRes?.chart?.result?.[0]?.meta;
        if (vixMeta?.regularMarketPrice) {
          const prev = vixMeta.chartPreviousClose || vixMeta.previousClose || vixMeta.regularMarketPrice;
          this.instFlow.vix = roundToDecimals(vixMeta.regularMarketPrice, 2);
          this.instFlow.vixChangePct = prev > 0 ? roundToDecimals(((vixMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
        }
        const gldMeta = gldRes?.chart?.result?.[0]?.meta;
        if (gldMeta?.regularMarketPrice) {
          const prev = gldMeta.chartPreviousClose || gldMeta.previousClose || gldMeta.regularMarketPrice;
          this.instFlow.gldPrice = roundToDecimals(gldMeta.regularMarketPrice, 2);
          this.instFlow.gldChangePct = prev > 0 ? roundToDecimals(((gldMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
          this.instFlow.gldVolume = Math.round(gldMeta.regularMarketVolume || 0);
        }
        const tipMeta = tipRes?.chart?.result?.[0]?.meta;
        if (tipMeta?.regularMarketPrice) {
          const prev = tipMeta.chartPreviousClose || tipMeta.previousClose || tipMeta.regularMarketPrice;
          this.instFlow.tipPrice = roundToDecimals(tipMeta.regularMarketPrice, 2);
          this.instFlow.tipChangePct = prev > 0 ? roundToDecimals(((tipMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
        }
        const gdxMeta = gdxRes?.chart?.result?.[0]?.meta;
        if (gdxMeta?.regularMarketPrice) {
          const prev = gdxMeta.chartPreviousClose || gdxMeta.previousClose || gdxMeta.regularMarketPrice;
          this.instFlow.gdxPrice = roundToDecimals(gdxMeta.regularMarketPrice, 2);
          this.instFlow.gdxChangePct = prev > 0 ? roundToDecimals(((gdxMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
        }
        const jpyMeta = jpyRes?.chart?.result?.[0]?.meta;
        if (jpyMeta?.regularMarketPrice) {
          const prev = jpyMeta.chartPreviousClose || jpyMeta.previousClose || jpyMeta.regularMarketPrice;
          this.instFlow.usdJpyPrice = roundToDecimals(jpyMeta.regularMarketPrice, 2);
          this.instFlow.usdJpyChangePct = prev > 0 ? roundToDecimals(((jpyMeta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
        }

        const siResult = siRes?.chart?.result?.[0];
        if (siResult?.meta?.regularMarketPrice) {
          const prev = siResult.meta.chartPreviousClose || siResult.meta.previousClose || siResult.meta.regularMarketPrice;
          this.instFlow.silverPrice = roundToDecimals(siResult.meta.regularMarketPrice, 3);
          this.instFlow.silverChangePct = prev > 0 ? roundToDecimals(((siResult.meta.regularMarketPrice - prev) / prev) * 100, 2) : 0;
          const tsList = siResult.timestamp || [];
          const q = siResult.indicators?.quote?.[0];
          if (tsList.length > 0 && q) {
            const parsedSi: Candle[] = [];
            for (let i = 0; i < tsList.length; i++) {
              const o = q.open?.[i];
              const h = q.high?.[i];
              const l = q.low?.[i];
              const c = q.close?.[i];
              if (o == null || h == null || l == null || c == null) continue;
              parsedSi.push({
                time: tsList[i],
                open: roundToDecimals(o, 3),
                high: roundToDecimals(h, 3),
                low: roundToDecimals(l, 3),
                close: roundToDecimals(c, 3),
                volume: Math.round(q.volume?.[i] ?? 50),
              });
            }
            if (parsedSi.length > 0) {
              this.silver5mCandles = parsedSi.slice(-80);
            }
          }
        }

        const oiNum = oiRes?.openInterest ? parseFloat(oiRes.openInterest) : NaN;
        const markNum = premRes?.markPrice ? parseFloat(premRes.markPrice) : NaN;
        const fundNum = premRes?.lastFundingRate ? parseFloat(premRes.lastFundingRate) : NaN;
        if (Number.isFinite(oiNum) && oiNum > 0) {
          this.instFlow.futuresOiOz = roundToDecimals(oiNum, 2);
          const refMark = Number.isFinite(markNum) && markNum > 0 ? markNum : this.instruments.get('XAU/USD')?.price || 0;
          if (refMark > 0) {
            this.futuresOiHistory = [
              ...this.futuresOiHistory.filter((h) => nowTs - h.ts <= 20 * 60_000),
              {ts: nowTs, oiOz: oiNum, markPrice: refMark},
            ];
            const baseline = this.futuresOiHistory.find((h) => nowTs - h.ts >= 60_000) || this.futuresOiHistory[0];
            if (baseline && baseline.oiOz > 0 && baseline.markPrice > 0) {
              this.instFlow.futuresOiDeltaPct = roundToDecimals(((oiNum - baseline.oiOz) / baseline.oiOz) * 100, 2);
              this.instFlow.futuresPriceDeltaPct = roundToDecimals(((refMark - baseline.markPrice) / baseline.markPrice) * 100, 2);
            }
          }
        }
        if (Number.isFinite(fundNum)) {
          this.instFlow.futuresFundingRate = Number(fundNum.toFixed(6));
        }
        if (Array.isArray(takerRes) && takerRes.length > 0) {
          const latestRatio = parseFloat(takerRes[takerRes.length - 1]?.buySellRatio || '');
          if (Number.isFinite(latestRatio) && latestRatio > 0) {
            this.instFlow.futuresTakerBuySellRatio = roundToDecimals(latestRatio, 2);
          }
        }
        this.instFlow.updatedAt = nowTs;
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
    const mt5Active = symbol === 'XAU/USD' && this.broker.isMt5Configured();
    const cacheTtlMs = mt5Active && Date.now() - this.mt5LastLiveAt < 8000 ? 4_000 : 10_000;
    if (existing && existing.length > 0 && Date.now() - lastFetch < cacheTtlMs) {
      return existing;
    }

    let parsed: Candle[] = [];

    if (mt5Active) {
      const mt5Candles = await this.broker.fetchMt5Candles(timeframe, 220);
      if (mt5Candles && mt5Candles.length > 0) {
        const inst = this.instruments.get(symbol);
        if (inst && inst.price > 0 && Date.now() - this.mt5LastLiveAt < 5000) {
          const lastBar = mt5Candles[mt5Candles.length - 1];
          lastBar.close = inst.price;
          lastBar.high = Math.max(lastBar.high, inst.price);
          lastBar.low = Math.min(lastBar.low, inst.price);
        }
        parsed = mt5Candles.slice(-220);
      }
    }

    if (parsed.length === 0 && seed.krakenPair) {
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
    } else if (parsed.length === 0 && seed.yahooSymbol) {
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

  private buildGoldCompactBook(
    bid: number,
    ask: number,
    decimals: number,
  ): {bids: OrderBookLevel[]; asks: OrderBookLevel[]} {
    const mid = (bid + ask) / 2;
    const step = 0.5;
    const bidMap = new Map<number, number>();
    const askMap = new Map<number, number>();
    for (const row of this.goldL2Raw.bids) {
      if (row.offset > 0) continue;
      const lvl = roundToDecimals(Math.floor((mid + row.offset) / step) * step, decimals);
      if (lvl <= bid) bidMap.set(lvl, (bidMap.get(lvl) || 0) + row.size);
    }
    for (const row of this.goldL2Raw.asks) {
      if (row.offset < 0) continue;
      const lvl = roundToDecimals(Math.ceil((mid + row.offset) / step) * step, decimals);
      if (lvl >= ask) askMap.set(lvl, (askMap.get(lvl) || 0) + row.size);
    }
    let bCum = 0;
    const bids: OrderBookLevel[] = Array.from(bidMap.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 10)
      .map(([price, raw]) => {
        const size = Number(raw.toFixed(2));
        bCum = Number((bCum + size).toFixed(2));
        return {price, size, total: bCum};
      });
    let aCum = 0;
    const asks: OrderBookLevel[] = Array.from(askMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([price, raw]) => {
        const size = Number(raw.toFixed(2));
        aCum = Number((aCum + size).toFixed(2));
        return {price, size, total: aCum};
      });
    return {bids, asks};
  }

  getDomLevel2(symbol: string, requestedStep?: number): DomLevel2Snapshot | null {
    const inst = this.instruments.get(symbol);
    if (!inst) return null;
    const dec = inst.decimals;
    const midPrice = roundToDecimals((inst.bid + inst.ask) / 2, dec);
    const spread = roundToDecimals(Math.max(0, inst.ask - inst.bid), dec);
    const isGold = symbol === 'XAU/USD' || symbol === 'GC1!';
    const defaultStep = isGold ? 0.5 : symbol === 'BTC/USD' ? 10 : inst.tickSize * 5;
    const stepSize =
      requestedStep && Number.isFinite(requestedStep) && requestedStep > 0
        ? requestedStep
        : defaultStep;

    type AggEntry = {size: number; venues: Set<string>};
    const bidBuckets = new Map<number, AggEntry>();
    const askBuckets = new Map<number, AggEntry>();
    let isRealL2 = false;
    let sourceLabel = 'Swissquote BBO Spread Tiers (Synthetic Depth)';

    if (isGold && this.goldL2Raw.bids.length > 0 && this.goldL2Raw.asks.length > 0) {
      isRealL2 = true;
      sourceLabel = `Real Multi-Venue L2 (${this.goldL2Raw.venues.join(' + ')} PAXG · Spot-Aligned)`;
      for (const b of this.goldL2Raw.bids) {
        if (b.offset > 0.05) continue;
        const rawPx = midPrice + b.offset;
        const bucket = roundToDecimals(Math.floor(rawPx / stepSize) * stepSize, dec);
        const existing = bidBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += b.size;
        existing.venues.add(b.venue);
        bidBuckets.set(bucket, existing);
      }
      for (const a of this.goldL2Raw.asks) {
        if (a.offset < -0.05) continue;
        const rawPx = midPrice + a.offset;
        const bucket = roundToDecimals(Math.ceil(rawPx / stepSize) * stepSize, dec);
        const existing = askBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += a.size;
        existing.venues.add(a.venue);
        askBuckets.set(bucket, existing);
      }
    } else if (symbol === 'BTC/USD' && this.btcL2Raw.bids.length > 0) {
      isRealL2 = true;
      sourceLabel = 'Real Kraken L2 Order Book (XBT/USD · 40 Levels)';
      for (const b of this.btcL2Raw.bids) {
        const bucket = roundToDecimals(Math.floor(b.price / stepSize) * stepSize, dec);
        const existing = bidBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += b.size;
        existing.venues.add('Kraken');
        bidBuckets.set(bucket, existing);
      }
      for (const a of this.btcL2Raw.asks) {
        const bucket = roundToDecimals(Math.ceil(a.price / stepSize) * stepSize, dec);
        const existing = askBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += a.size;
        existing.venues.add('Kraken');
        askBuckets.set(bucket, existing);
      }
    } else {
      for (const b of inst.bids) {
        const bucket = roundToDecimals(b.price, dec);
        const existing = bidBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += b.size;
        existing.venues.add(inst.dataSource || 'Feed');
        bidBuckets.set(bucket, existing);
      }
      for (const a of inst.asks) {
        const bucket = roundToDecimals(a.price, dec);
        const existing = askBuckets.get(bucket) || {size: 0, venues: new Set<string>()};
        existing.size += a.size;
        existing.venues.add(inst.dataSource || 'Feed');
        askBuckets.set(bucket, existing);
      }
    }

    const rawBids = Array.from(bidBuckets.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, 22);
    const rawAsks = Array.from(askBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 22);

    const avgBid =
      rawBids.length > 0
        ? rawBids.reduce((s, [, v]) => s + v.size, 0) / rawBids.length
        : 0;
    const avgAsk =
      rawAsks.length > 0
        ? rawAsks.reduce((s, [, v]) => s + v.size, 0) / rawAsks.length
        : 0;
    const bidWallThreshold = avgBid * 1.85;
    const askWallThreshold = avgAsk * 1.85;

    let bidCum = 0;
    const bids = rawBids.map(([price, entry]) => {
      const size = Number(entry.size.toFixed(symbol === 'BTC/USD' ? 3 : 2));
      bidCum = Number((bidCum + size).toFixed(2));
      return {
        price,
        size,
        total: bidCum,
        isWall: size > 0 && size >= bidWallThreshold,
        venues: Array.from(entry.venues).join('+'),
      };
    });

    let askCum = 0;
    const asks = rawAsks.map(([price, entry]) => {
      const size = Number(entry.size.toFixed(symbol === 'BTC/USD' ? 3 : 2));
      askCum = Number((askCum + size).toFixed(2));
      return {
        price,
        size,
        total: askCum,
        isWall: size > 0 && size >= askWallThreshold,
        venues: Array.from(entry.venues).join('+'),
      };
    });

    const top5Bid = bids.slice(0, 5).reduce((s, l) => s + l.size, 0);
    const top5Ask = asks.slice(0, 5).reduce((s, l) => s + l.size, 0);
    const top5Total = top5Bid + top5Ask;
    const top5BidRatioPct = top5Total > 0 ? Math.round((top5Bid / top5Total) * 100) : 50;

    const totalBidLiquidity = Number(bids.reduce((s, l) => s + l.size, 0).toFixed(2));
    const totalAskLiquidity = Number(asks.reduce((s, l) => s + l.size, 0).toFixed(2));
    const fullTotal = totalBidLiquidity + totalAskLiquidity;
    const fullBookBidRatioPct = fullTotal > 0 ? Math.round((totalBidLiquidity / fullTotal) * 100) : 50;

    const bestBid = bids[0]?.price ?? inst.bid;
    const bestAsk = asks[0]?.price ?? inst.ask;
    const bestBidSz = bids[0]?.size ?? 1;
    const bestAskSz = asks[0]?.size ?? 1;
    const microPrice =
      bestBidSz + bestAskSz > 0
        ? roundToDecimals((bestBid * bestAskSz + bestAsk * bestBidSz) / (bestBidSz + bestAskSz), dec)
        : midPrice;
    const microPriceDelta = roundToDecimals(microPrice - midPrice, Math.max(dec, 3));

    const wallBidRow = bids.find((b) => b.isWall) || [...bids].sort((a, b) => b.size - a.size)[0] || null;
    const wallAskRow = asks.find((a) => a.isWall) || [...asks].sort((a, b) => b.size - a.size)[0] || null;

    const nearestBidWall: DomWallInfo | null = wallBidRow
      ? {
          side: 'BID',
          price: wallBidRow.price,
          size: wallBidRow.size,
          distanceDollars: roundToDecimals(Math.max(0, midPrice - wallBidRow.price), dec),
          venueLabel: wallBidRow.venues || 'Book',
        }
      : null;

    const nearestAskWall: DomWallInfo | null = wallAskRow
      ? {
          side: 'ASK',
          price: wallAskRow.price,
          size: wallAskRow.size,
          distanceDollars: roundToDecimals(Math.max(0, wallAskRow.price - midPrice), dec),
          venueLabel: wallAskRow.venues || 'Book',
        }
      : null;

    let wallVelocity: DomWallVelocity = 'BALANCED';
    let bidWallDelta = 0;
    let askWallDelta = 0;
    if (isGold && this.goldL2History.length >= 2) {
      const latestHist = this.goldL2History[this.goldL2History.length - 1];
      const refHist =
        [...this.goldL2History].reverse().find((h) => latestHist.ts - h.ts >= 3500) ||
        this.goldL2History[0];
      const vel = classifyDomWallVelocity(
        refHist.top5Bid,
        refHist.top5Ask,
        latestHist.top5Bid,
        latestHist.top5Ask,
      );
      wallVelocity = vel.velocity;
      bidWallDelta = vel.bidDelta;
      askWallDelta = vel.askDelta;
    }

    return {
      symbol,
      sourceLabel,
      isRealL2,
      timestamp: Date.now(),
      midPrice,
      microPrice,
      microPriceDelta,
      spread,
      stepSize,
      top5BidRatioPct,
      fullBookBidRatioPct,
      totalBidLiquidity,
      totalAskLiquidity,
      nearestBidWall,
      nearestAskWall,
      wallVelocity,
      bidWallDelta,
      askWallDelta,
      asks,
      bids,
      tiers: this.spreadTiers.get(symbol) || [],
    };
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

  getInstitutionalGold(): InstitutionalGoldContext {
    let score = 0;
    const notes: string[] = [];

    if (this.cotPositioning) {
      if (this.cotPositioning.bias === 'BULLISH') {
        score += 3;
        notes.push(`COT Funds Net +${this.cotPositioning.managedMoneyNet.toLocaleString()}`);
      } else if (this.cotPositioning.bias === 'BEARISH') {
        score -= 3;
        notes.push(`COT Funds trimming (${this.cotPositioning.managedMoneyNetChange.toLocaleString()} WoW)`);
      }
    }

    if (this.instFlow.gldPrice !== null) {
      if (this.instFlow.gldChangePct >= 0.25) {
        score += 3;
        notes.push(`GLD +${this.instFlow.gldChangePct}%`);
      } else if (this.instFlow.gldChangePct <= -0.25) {
        score -= 3;
        notes.push(`GLD ${this.instFlow.gldChangePct}%`);
      }
    }

    if (this.instFlow.tipPrice !== null) {
      if (this.instFlow.tipChangePct >= 0.12) {
        score += 2;
        notes.push(`TIP +${this.instFlow.tipChangePct}% (Real Yields ↓)`);
      } else if (this.instFlow.tipChangePct <= -0.12) {
        score -= 2;
        notes.push(`TIP ${this.instFlow.tipChangePct}% (Real Yields ↑)`);
      }
    }

    if (this.instFlow.gdxPrice !== null) {
      if (this.instFlow.gdxChangePct >= 0.4) {
        score += 2;
        notes.push(`GDX +${this.instFlow.gdxChangePct}%`);
      } else if (this.instFlow.gdxChangePct <= -0.4) {
        score -= 2;
        notes.push(`GDX ${this.instFlow.gdxChangePct}%`);
      }
    }

    if (this.instFlow.paxgBuyVolumeOz + this.instFlow.paxgSellVolumeOz > 0) {
      if (this.instFlow.paxgBuyPct >= 56) {
        score += 3;
        notes.push(`PAXG Flow ${this.instFlow.paxgBuyPct}% Buy`);
      } else if (this.instFlow.paxgBuyPct <= 44) {
        score -= 3;
        notes.push(`PAXG Flow ${100 - this.instFlow.paxgBuyPct}% Sell`);
      }
    }

    const xau5m = this.candleCache.get('XAU/USD')?.get('5m') || this.candleCache.get('XAU/USD')?.get('15m') || [];
    const smtDivergence = detectSilverGoldSmt(xau5m, this.silver5mCandles);
    if (smtDivergence === 'BULLISH_SMT') {
      score += 2;
      notes.push('Bullish Gold/Silver SMT');
    } else if (smtDivergence === 'BEARISH_SMT') {
      score -= 2;
      notes.push('Bearish Gold/Silver SMT');
    }

    const xauChangeDelta = this.instFlow.futuresPriceDeltaPct || 0;
    const futuresRegime: FuturesOiRegime = classifyFuturesOiRegime(
      xauChangeDelta,
      this.instFlow.futuresOiDeltaPct,
    );
    if (futuresRegime === 'NEW_LONGS') {
      score += 2;
      notes.push(`Perp OI +${this.instFlow.futuresOiDeltaPct}% New Longs`);
    } else if (futuresRegime === 'NEW_SHORTS') {
      score -= 2;
      notes.push(`Perp OI +${this.instFlow.futuresOiDeltaPct}% New Shorts`);
    } else if (futuresRegime === 'SHORT_COVERING') {
      notes.push('Short-Covering Squeeze (OI ↓)');
    } else if (futuresRegime === 'LONG_LIQUIDATION') {
      notes.push('Long Liquidation Flush (OI ↓)');
    }

    const goldDom = this.getDomLevel2('XAU/USD', 0.5);
    if (goldDom && goldDom.isRealL2) {
      if (goldDom.top5BidRatioPct >= 60 && goldDom.microPriceDelta > 0) score += 1;
      else if (goldDom.top5BidRatioPct <= 40 && goldDom.microPriceDelta < 0) score -= 1;
      if (goldDom.wallVelocity === 'PULLING_ASKS' || goldDom.wallVelocity === 'STACKING_BIDS') score += 1;
      else if (goldDom.wallVelocity === 'PULLING_BIDS' || goldDom.wallVelocity === 'STACKING_ASKS') score -= 1;
    }

    const volatilityAlert = Boolean(
      (this.instFlow.gvz !== null && this.instFlow.gvz >= 29) ||
        this.instFlow.gvzChangePct >= 8,
    );
    if (volatilityAlert) {
      notes.push(`GVZ Vol Spike (${this.instFlow.gvz ?? '--'})`);
    }

    const compositeBias: InstitutionalGoldContext['compositeBias'] =
      score >= 3 ? 'BULLISH' : score <= -3 ? 'BEARISH' : 'NEUTRAL';

    return {
      cot: this.cotPositioning,
      gvz: this.instFlow.gvz,
      gvzChangePct: this.instFlow.gvzChangePct,
      vix: this.instFlow.vix,
      vixChangePct: this.instFlow.vixChangePct,
      gldPrice: this.instFlow.gldPrice,
      gldChangePct: this.instFlow.gldChangePct,
      gldVolume: this.instFlow.gldVolume,
      paxgPrice: this.instFlow.paxgPrice,
      paxgBuyVolumeOz: this.instFlow.paxgBuyVolumeOz,
      paxgSellVolumeOz: this.instFlow.paxgSellVolumeOz,
      paxgNetDeltaOz: this.instFlow.paxgNetDeltaOz,
      paxgBuyPct: this.instFlow.paxgBuyPct,
      paxgBookBidPct: this.instFlow.paxgBookBidPct,
      paxgLargePrints: this.instFlow.paxgLargePrints,
      l2Top5BidPct: goldDom?.top5BidRatioPct,
      l2FullBidPct: goldDom?.fullBookBidRatioPct,
      l2MicroTiltDollars: goldDom?.microPriceDelta,
      l2NearestBidWall: goldDom?.nearestBidWall ?? null,
      l2NearestAskWall: goldDom?.nearestAskWall ?? null,
      l2SourceSummary: goldDom?.sourceLabel,
      l2WallVelocity: goldDom?.wallVelocity ?? 'BALANCED',
      l2BidWallDelta: goldDom?.bidWallDelta ?? 0,
      l2AskWallDelta: goldDom?.askWallDelta ?? 0,
      futuresOiOz: this.instFlow.futuresOiOz,
      futuresOiDeltaPct: this.instFlow.futuresOiDeltaPct,
      futuresFundingRate: this.instFlow.futuresFundingRate,
      futuresTakerBuySellRatio: this.instFlow.futuresTakerBuySellRatio,
      futuresRegime,
      tipPrice: this.instFlow.tipPrice,
      tipChangePct: this.instFlow.tipChangePct,
      gdxPrice: this.instFlow.gdxPrice,
      gdxChangePct: this.instFlow.gdxChangePct,
      silverPrice: this.instFlow.silverPrice,
      silverChangePct: this.instFlow.silverChangePct,
      usdJpyPrice: this.instFlow.usdJpyPrice,
      usdJpyChangePct: this.instFlow.usdJpyChangePct,
      smtDivergence,
      compositeBias,
      compositeScore: score,
      volatilityAlert,
      summary: notes.length > 0 ? notes.join(' · ') : 'Neutral institutional positioning',
      updatedAt: this.instFlow.updatedAt || Date.now(),
    };
  }

  addSubscriber(res: express.Response) {
    this.subscribers.add(res);
  }

  removeSubscriber(res: express.Response) {
    this.subscribers.delete(res);
  }
}
