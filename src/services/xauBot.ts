import {analyzeORB} from './orbAnalyzer';
import {analyzeOrderFlow} from './orderFlowAnalyzer';
import {
  calculateBollinger,
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  computeUnrealizedPnl,
  formatPrice,
} from './tradingMath';
import type {
  Candle,
  EconomicCalendarSnapshot,
  EconomicEvent,
  Instrument,
  MacroGoldContext,
  MarketPrint,
  MtfTimeframeTrend,
  OrderSide,
  ORBWindowMinutes,
  PendingOrder,
  Position,
  Timeframe,
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotStrategy,
  XauBotTradeRecord,
} from '../types/trading';

export function createDefaultXauBotConfig(): XauBotConfig {
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

export interface MultiTradePlan {
  allowed: boolean;
  reason?: string;
  tierNumber: number;
  isRunner: boolean;
  tpMultiplier: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopDistance: number | null;
}

export function evaluateMultiTradeEntry(params: {
  action: 'BUY' | 'SELL';
  confidence: number;
  entryPrice: number;
  baseStopLoss: number;
  baseTakeProfit: number;
  atr14: number;
  openBotPositions: Array<{side: 'BUY' | 'SELL'; entryPrice: number}>;
  config: XauBotConfig;
  ignoreSpacing?: boolean;
}): MultiTradePlan {
  const {
    action,
    confidence,
    entryPrice,
    baseStopLoss,
    baseTakeProfit,
    atr14,
    openBotPositions,
    config,
    ignoreSpacing = false,
  } = params;

  const maxTrades = Math.max(1, Math.min(10, Math.round(config.maxConcurrentPositions || 1)));
  if (openBotPositions.length >= maxTrades) {
    return {
      allowed: false,
      reason: `Max open bot trades reached (${openBotPositions.length}/${maxTrades})`,
      tierNumber: openBotPositions.length,
      isRunner: false,
      tpMultiplier: 1,
      stopLoss: baseStopLoss,
      takeProfit: baseTakeProfit,
      trailingStopDistance: config.trailingStopDollars,
    };
  }

  const sameSide = openBotPositions.filter((p) => p.side === action);
  const oppositeSide = openBotPositions.filter((p) => p.side !== action);

  // If stacking in the same direction, avoid duplicate fills at the exact same price
  // unless price expanded enough (ATR-scaled step) or signal has very high conviction.
  if (!ignoreSpacing && sameSide.length > 0) {
    const minStep = Math.max(1.2, round2((atr14 > 0 ? atr14 : 2.0) * 0.35));
    const closestDist = Math.min(
      ...sameSide.map((p) => Math.abs(p.entryPrice - entryPrice)),
    );
    if (closestDist < minStep && confidence < 76) {
      return {
        allowed: false,
        reason: `Waiting for $${minStep.toFixed(2)}/oz spacing from last ${action} entry (dist $${closestDist.toFixed(2)}, conf ${confidence}%)`,
        tierNumber: sameSide.length + 1,
        isRunner: true,
        tpMultiplier: 1,
        stopLoss: baseStopLoss,
        takeProfit: baseTakeProfit,
        trailingStopDistance: config.trailingStopDollars,
      };
    }
  }

  // If hedging against an existing opposite position, require solid directional confidence.
  if (!ignoreSpacing && oppositeSide.length > 0 && sameSide.length === 0) {
    const hedgeFloor = Math.max(config.minConfidence, 65);
    if (confidence < hedgeFloor) {
      return {
        allowed: false,
        reason: `Counter-position requires >=${hedgeFloor}% confidence (got ${confidence}%)`,
        tierNumber: 1,
        isRunner: false,
        tpMultiplier: 1,
        stopLoss: baseStopLoss,
        takeProfit: baseTakeProfit,
        trailingStopDistance: config.trailingStopDollars,
      };
    }
  }

  const tierIndex = sameSide.length; // 0 = Core #1, 1 = Runner #2, 2 = Runner #3...
  const tierNumber = tierIndex + 1;
  const isRunner = tierIndex > 0;
  const tpMultiplier = round2(1 + tierIndex * 0.35);

  const baseTpDist = Math.max(1, Math.abs(baseTakeProfit - entryPrice));
  const scaledTpDist = round2(baseTpDist * tpMultiplier);
  const scaledTakeProfit =
    action === 'BUY'
      ? round2(entryPrice + scaledTpDist)
      : round2(entryPrice - scaledTpDist);

  // Stacked runner entries automatically carry a trailing stop to protect multi-position profit
  const runnerTrail = isRunner
    ? config.trailingStopDollars ?? Math.max(4.5, round2(config.stopLossDollars * 0.75))
    : config.trailingStopDollars;

  return {
    allowed: true,
    tierNumber,
    isRunner,
    tpMultiplier,
    stopLoss: baseStopLoss,
    takeProfit: scaledTakeProfit,
    trailingStopDistance: runnerTrail,
  };
}

export interface SessionSpreadInfo {
  sessionName: 'LONDON_NY_OVERLAP' | 'LONDON' | 'NEW_YORK' | 'ASIA' | 'ROLLOVER';
  sessionLabel: string;
  liquidityQuality: 'PRIME' | 'GOOD' | 'THIN';
  confidenceDelta: number;
  spreadDollars: number;
  maxSpreadDollars: number;
  spreadOk: boolean;
}

export function analyzeGoldSessionAndSpread(
  instrument: Instrument,
  nowMs: number = Date.now(),
  maxSpreadDollars: number = 1.2,
): SessionSpreadInfo {
  const utcHour = new Date(nowMs).getUTCHours();
  let sessionName: SessionSpreadInfo['sessionName'] = 'ASIA';
  let sessionLabel = 'Asia Session';
  let liquidityQuality: SessionSpreadInfo['liquidityQuality'] = 'THIN';
  let confidenceDelta = -4;

  if (utcHour >= 12 && utcHour <= 16) {
    sessionName = 'LONDON_NY_OVERLAP';
    sessionLabel = 'London / NY Overlap';
    liquidityQuality = 'PRIME';
    confidenceDelta = 5;
  } else if (utcHour >= 7 && utcHour < 12) {
    sessionName = 'LONDON';
    sessionLabel = 'London Session';
    liquidityQuality = 'GOOD';
    confidenceDelta = 3;
  } else if (utcHour >= 17 && utcHour <= 20) {
    sessionName = 'NEW_YORK';
    sessionLabel = 'New York PM';
    liquidityQuality = 'GOOD';
    confidenceDelta = 1;
  } else if (utcHour === 21 || utcHour === 22) {
    sessionName = 'ROLLOVER';
    sessionLabel = 'Daily Rollover';
    liquidityQuality = 'THIN';
    confidenceDelta = -10;
  }

  const spreadDollars = round2(Math.max(0, instrument.ask - instrument.bid));
  const limit = Math.max(0.2, maxSpreadDollars || 1.2);
  return {
    sessionName,
    sessionLabel,
    liquidityQuality,
    confidenceDelta,
    spreadDollars,
    maxSpreadDollars: limit,
    spreadOk: spreadDollars <= limit,
  };
}

export function computeMtfTrends(
  mtfCandles: Partial<Record<Timeframe, Candle[]>>,
): {
  trends: MtfTimeframeTrend[];
  overallBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
} {
  const timeframes: Timeframe[] = ['5m', '15m', '1H', '4H'];
  const trends: MtfTimeframeTrend[] = [];

  for (const tf of timeframes) {
    const bars = mtfCandles[tf];
    if (!bars || bars.length < 22) continue;
    const ema9Arr = calculateEMA(bars, 9);
    const ema21Arr = calculateEMA(bars, 21);
    const rsiArr = calculateRSI(bars, 14);
    const idx = bars.length - 1;
    const ema9 = ema9Arr[idx] ?? bars[idx].close;
    const ema21 = ema21Arr[idx] ?? bars[idx].close;
    const rsi14 = rsiArr[idx] ?? 50;
    const close = bars[idx].close;

    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (ema9 > ema21 && close >= ema21 && rsi14 >= 48) {
      trend = 'BULLISH';
    } else if (ema9 < ema21 && close <= ema21 && rsi14 <= 52) {
      trend = 'BEARISH';
    }

    trends.push({
      timeframe: tf,
      trend,
      ema9: round2(ema9),
      ema21: round2(ema21),
      rsi14: Number(rsi14.toFixed(1)),
      close: round2(close),
    });
  }

  // Weight 15m and 1H heavily for intraday XAU/USD direction
  let score = 0;
  for (const t of trends) {
    const w = t.timeframe === '1H' ? 2 : t.timeframe === '15m' ? 2 : 1;
    if (t.trend === 'BULLISH') score += w;
    else if (t.trend === 'BEARISH') score -= w;
  }

  const overallBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    score >= 2 ? 'BULLISH' : score <= -2 ? 'BEARISH' : 'NEUTRAL';

  return {trends, overallBias};
}

export interface XauBotEvaluation {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  stopLoss: number;
  takeProfit: number;
  indicators: {
    ema9: number;
    ema21: number;
    vwap: number;
    rsi14: number;
    orHigh: number | null;
    orLow: number | null;
  };
  orderFlow: {
    buyPressurePct: number;
    bookImbalancePct: number;
    cvd: number;
    pocPrice: number;
    vahPrice: number;
    valPrice: number;
    atr14: number;
    verdict: string;
  } | null;
  mtfTrends: MtfTimeframeTrend[];
  mtfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  macro: MacroGoldContext | null;
  sessionInfo: SessionSpreadInfo;
  newsStatus: {
    blocked: boolean;
    activeEvent: EconomicEvent | null;
    nextEvent: EconomicEvent | null;
    minutesUntilNext: number | null;
    reason: string;
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function evaluateXauBotSignal(
  instrument: Instrument,
  candles: Candle[],
  config: XauBotConfig,
  orbWindowMinutes: ORBWindowMinutes = 15,
  recentPrints: MarketPrint[] = [],
  pendingOrders: PendingOrder[] = [],
  context?: {
    mtfCandles?: Partial<Record<Timeframe, Candle[]>>;
    macro?: MacroGoldContext | null;
    calendar?: EconomicCalendarSnapshot | null;
    nowMs?: number;
  },
): XauBotEvaluation | null {
  if (!candles || candles.length < 22) return null;

  const ema9Arr = calculateEMA(candles, 9);
  const ema21Arr = calculateEMA(candles, 21);
  const vwapArr = calculateVWAP(candles);
  const rsiArr = calculateRSI(candles, 14);
  const bb = calculateBollinger(candles, 20, 2);

  const idx = candles.length - 1;
  const prevIdx = idx - 1;

  const ema9 = ema9Arr[idx] ?? instrument.price;
  const prevEma9 = ema9Arr[prevIdx] ?? ema9;
  const ema21 = ema21Arr[idx] ?? instrument.price;
  const prevEma21 = ema21Arr[prevIdx] ?? ema21;
  const vwap = vwapArr[idx] ?? instrument.price;
  const rsi14 = rsiArr[idx] ?? 50;
  const bbUpper = bb.upper[idx] ?? instrument.price + 10;
  const bbLower = bb.lower[idx] ?? instrument.price - 10;

  const orb = analyzeORB(instrument, candles, orbWindowMinutes);
  const flow = analyzeOrderFlow(instrument, candles, recentPrints, pendingOrders);

  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 40;
  let reason = 'Monitoring live XAU/USD ticks...';

  if (config.strategy === 'ORB_VWAP') {
    if (orb) {
      confidence = orb.confidenceScore;
      if (
        (orb.signal === 'LONG_BREAKOUT' || orb.signal === 'LONG_RETEST') &&
        instrument.price >= vwap &&
        confidence >= config.minConfidence
      ) {
        action = 'BUY';
        reason = `${orb.signal.replace('_', ' ')} above OR High (${formatPrice(
          orb.orHigh,
          2,
        )}) & VWAP (${formatPrice(vwap, 2)})`;
      } else if (
        (orb.signal === 'SHORT_BREAKOUT' || orb.signal === 'SHORT_RETEST') &&
        instrument.price <= vwap &&
        confidence >= config.minConfidence
      ) {
        action = 'SELL';
        reason = `${orb.signal.replace('_', ' ')} below OR Low (${formatPrice(
          orb.orLow,
          2,
        )}) & VWAP (${formatPrice(vwap, 2)})`;
      } else {
        reason = `Waiting: ${orb.signal.replace('_', ' ')} (Conf ${confidence}% / Min ${
          config.minConfidence
        }%). Long > ${formatPrice(orb.orHigh, 2)}, Short < ${formatPrice(orb.orLow, 2)}.`;
      }
    }
  } else if (config.strategy === 'EMA_MOMENTUM') {
    const bullishCross = prevEma9 <= prevEma21 && ema9 > ema21;
    const bearishCross = prevEma9 >= prevEma21 && ema9 < ema21;
    const bullishTrend = ema9 > ema21 && instrument.price > vwap && rsi14 >= 52 && rsi14 <= 72;
    const bearishTrend = ema9 < ema21 && instrument.price < vwap && rsi14 <= 48 && rsi14 >= 28;

    if (bullishCross || bullishTrend) {
      action = 'BUY';
      confidence = bullishCross ? 84 : 68;
      reason = `EMA9 (${formatPrice(ema9, 2)}) > EMA21 (${formatPrice(
        ema21,
        2,
      )}), above VWAP (${formatPrice(vwap, 2)}), RSI ${rsi14.toFixed(1)}`;
    } else if (bearishCross || bearishTrend) {
      action = 'SELL';
      confidence = bearishCross ? 84 : 68;
      reason = `EMA9 (${formatPrice(ema9, 2)}) < EMA21 (${formatPrice(
        ema21,
        2,
      )}), below VWAP (${formatPrice(vwap, 2)}), RSI ${rsi14.toFixed(1)}`;
    } else {
      confidence = 42;
      reason = `Neutral momentum: EMA9 ${formatPrice(ema9, 2)} vs EMA21 ${formatPrice(
        ema21,
        2,
      )} · RSI ${rsi14.toFixed(1)}`;
    }
  } else if (config.strategy === 'BOLLINGER_REVERSION') {
    if (instrument.price <= bbLower && rsi14 <= 36) {
      action = 'BUY';
      confidence = 78;
      reason = `Lower Bollinger touch (${formatPrice(
        bbLower,
        2,
      )}) with oversold RSI ${rsi14.toFixed(1)}`;
    } else if (instrument.price >= bbUpper && rsi14 >= 64) {
      action = 'SELL';
      confidence = 78;
      reason = `Upper Bollinger touch (${formatPrice(
        bbUpper,
        2,
      )}) with overbought RSI ${rsi14.toFixed(1)}`;
    } else {
      confidence = 45;
      reason = `Inside Bollinger Band (${formatPrice(bbLower, 2)}–${formatPrice(
        bbUpper,
        2,
      )}), RSI ${rsi14.toFixed(1)}`;
    }
  } else if (config.strategy === 'ORDERFLOW_LIQUIDITY' && flow) {
    const nearSupport =
      instrument.price >= flow.valPrice - flow.atr14 * 0.4 &&
      instrument.price <= flow.pocPrice + flow.atr14 * 0.6;
    const nearResistance =
      instrument.price <= flow.vahPrice + flow.atr14 * 0.4 &&
      instrument.price >= flow.pocPrice - flow.atr14 * 0.6;

    if (
      flow.buyPressurePct >= 56 &&
      flow.bookImbalancePct >= 50 &&
      (flow.verdict === 'STRONG_BUY' || nearSupport || instrument.price > flow.pocPrice)
    ) {
      action = 'BUY';
      confidence = flow.verdict === 'STRONG_BUY' ? 84 : 70;
      reason = `Order Flow Buy ${flow.buyPressurePct}% · Book Bids ${flow.bookImbalancePct}% · POC ${formatPrice(
        flow.pocPrice,
        2,
      )}`;
    } else if (
      flow.sellPressurePct >= 56 &&
      flow.bookImbalancePct <= 50 &&
      (flow.verdict === 'STRONG_SELL' || nearResistance || instrument.price < flow.pocPrice)
    ) {
      action = 'SELL';
      confidence = flow.verdict === 'STRONG_SELL' ? 84 : 70;
      reason = `Order Flow Sell ${flow.sellPressurePct}% · Book Asks ${
        100 - flow.bookImbalancePct
      }% · POC ${formatPrice(flow.pocPrice, 2)}`;
    } else {
      confidence = Math.max(40, Math.min(62, flow.verdictScore));
      reason = `Balanced flow (${flow.buyPressurePct}% Buy / ${flow.bookImbalancePct}% Bid) around POC ${formatPrice(
        flow.pocPrice,
        2,
      )}`;
    }
  }

  const useOrderFlow = config.useOrderFlowConfluence ?? true;
  const useMtf = config.useMtfConfluence ?? true;
  const useMacro = config.useMacroConfluence ?? true;
  const useSessionGuard = config.useSessionSpreadGuard ?? true;
  const maxSpread = config.maxSpreadDollars ?? 1.2;

  const sessionInfo = analyzeGoldSessionAndSpread(
    instrument,
    context?.nowMs ?? Date.now(),
    maxSpread,
  );
  const {trends: mtfTrends, overallBias: mtfBias} = computeMtfTrends(
    context?.mtfCandles ?? {},
  );
  const macro = context?.macro ?? null;

  // 1. Order Flow & Liquidity Confluence Gate across ALL strategies
  if (flow && useOrderFlow && action !== 'HOLD') {
    if (action === 'BUY') {
      if (flow.buyPressurePct <= 41 && flow.bookImbalancePct < 48) {
        confidence = Math.max(20, confidence - 16);
        reason = `Order Flow vetoed BUY (Sellers ${flow.sellPressurePct}%, Ask wall ${
          100 - flow.bookImbalancePct
        }%): ${reason}`;
      } else if (flow.buyPressurePct >= 54 || flow.bookImbalancePct >= 54) {
        confidence = Math.min(96, confidence + 8);
        reason = `${reason} · Flow + (${flow.buyPressurePct}% Buyers, POC ${formatPrice(
          flow.pocPrice,
          2,
        )})`;
      }
    } else if (action === 'SELL') {
      if (flow.buyPressurePct >= 59 && flow.bookImbalancePct > 52) {
        confidence = Math.max(20, confidence - 16);
        reason = `Order Flow vetoed SELL (Buyers ${flow.buyPressurePct}%, Bid wall ${flow.bookImbalancePct}%): ${reason}`;
      } else if (flow.sellPressurePct >= 54 || flow.bookImbalancePct <= 46) {
        confidence = Math.min(96, confidence + 8);
        reason = `${reason} · Flow + (${flow.sellPressurePct}% Sellers, POC ${formatPrice(
          flow.pocPrice,
          2,
        )})`;
      }
    }
  }

  // 2. Multi-Timeframe Confluence (15m + 1H higher-timeframe trend alignment)
  if (useMtf && action !== 'HOLD' && mtfTrends.length > 0) {
    const tf15 = mtfTrends.find((t) => t.timeframe === '15m')?.trend;
    const tf1h = mtfTrends.find((t) => t.timeframe === '1H')?.trend;
    const desired = action === 'BUY' ? 'BULLISH' : 'BEARISH';
    const opposite = action === 'BUY' ? 'BEARISH' : 'BULLISH';

    if (tf15 === opposite && tf1h === opposite) {
      confidence = Math.max(15, confidence - 18);
      reason = `MTF veto (${tf15} 15m & ${tf1h} 1H counter-trend): ${reason}`;
    } else if (mtfBias === opposite) {
      confidence = Math.max(20, confidence - 10);
      reason = `${reason} · MTF caution (${mtfBias})`;
    } else if (mtfBias === desired) {
      confidence = Math.min(97, confidence + 9);
      reason = `${reason} · MTF Aligned (${desired})`;
    }
  }

  // 3. Macro Intermarket Correlation (DXY + US10Y Yields + COMEX GC1! Basis)
  if (useMacro && macro && action !== 'HOLD') {
    const desired = action === 'BUY' ? 'BULLISH' : 'BEARISH';
    const opposite = action === 'BUY' ? 'BEARISH' : 'BULLISH';
    const boost = Math.min(10, Math.max(4, Math.abs(macro.macroScore)));

    if (macro.macroBias === desired) {
      confidence = Math.min(98, confidence + boost);
      reason = `${reason} · Macro + (DXY ${macro.dxyChangePct >= 0 ? '+' : ''}${macro.dxyChangePct}%, GC basis ${macro.gcBasis >= 0 ? '+' : ''}${macro.gcBasis})`;
    } else if (macro.macroBias === opposite) {
      const penalty = Math.abs(macro.macroScore) >= 6 ? 11 : 6;
      confidence = Math.max(20, confidence - penalty);
      reason = `${reason} · Macro headwind (${macro.macroBias})`;
    }
  }

  // 4. Session & Spread Guard (blocks wide spreads / adjusts session quality)
  if (useSessionGuard && action !== 'HOLD') {
    if (!sessionInfo.spreadOk) {
      reason = `Spread Guard paused ${action}: spread $${sessionInfo.spreadDollars.toFixed(
        2,
      )}/oz > max $${sessionInfo.maxSpreadDollars.toFixed(2)}/oz`;
      action = 'HOLD';
      confidence = Math.min(confidence, 40);
    } else {
      confidence = Math.max(15, Math.min(98, confidence + sessionInfo.confidenceDelta));
      if (sessionInfo.sessionName === 'LONDON_NY_OVERLAP') {
        reason = `${reason} · Prime Overlap`;
      } else if (sessionInfo.sessionName === 'ROLLOVER') {
        reason = `${reason} · Rollover caution`;
      }
    }
  }

  // 5. Economic Calendar News Guard (pauses entries around High-Impact USD events)
  const nowMs = context?.nowMs ?? Date.now();
  const useNewsGuard = config.useNewsGuard ?? true;
  const pauseBefore = Math.max(5, config.newsPauseMinutesBefore ?? 15);
  const pauseAfter = Math.max(5, config.newsPauseMinutesAfter ?? 15);
  const calendar = context?.calendar ?? null;

  let newsBlocked = false;
  let activeNewsEvent: EconomicEvent | null = null;
  let nextNewsEvent: EconomicEvent | null = calendar?.nextHighImpactUsd ?? null;
  let minutesUntilNext: number | null = calendar?.minutesToNextHighUsd ?? null;
  let newsReason = 'No high-impact USD news nearby';

  if (calendar?.events?.length) {
    const highUsdEvents = calendar.events.filter(
      (ev) => ev.impact === 'High' && (ev.country === 'USD' || ev.country === 'EUR'),
    );
    const guardHit = highUsdEvents.find((ev) => {
      const diffMin = (ev.timestamp - nowMs) / 60_000;
      return diffMin <= pauseBefore && diffMin >= -pauseAfter;
    });
    if (guardHit) {
      activeNewsEvent = guardHit;
      const diffMin = Math.round((guardHit.timestamp - nowMs) / 60_000);
      newsReason =
        diffMin >= 0
          ? `${guardHit.country} ${guardHit.title} in ${diffMin}m`
          : `${guardHit.country} ${guardHit.title} ${Math.abs(diffMin)}m ago`;
      if (useNewsGuard) {
        newsBlocked = true;
      }
    } else if (!nextNewsEvent) {
      const upcoming = highUsdEvents.find((ev) => ev.timestamp >= nowMs);
      if (upcoming) {
        nextNewsEvent = upcoming;
        minutesUntilNext = Math.round((upcoming.timestamp - nowMs) / 60_000);
      }
    }
  }

  if (newsBlocked && action !== 'HOLD') {
    reason = `News Guard paused ${action}: ${newsReason}`;
    action = 'HOLD';
    confidence = Math.min(confidence, 35);
  }

  if (confidence < config.minConfidence && action !== 'HOLD') {
    reason = `Signal suppressed (${confidence}% < min ${config.minConfidence}%): ${reason}`;
    action = 'HOLD';
  }

  // ATR-aware SL floor when Order Flow filter is enabled (keeps stops outside gold noise)
  const effectiveSl =
    flow && useOrderFlow && flow.atr14 > 0
      ? Math.min(20, Math.max(config.stopLossDollars, round2(flow.atr14 * 1.1)))
      : config.stopLossDollars;
  const effectiveTp = Math.max(config.takeProfitDollars, round2(effectiveSl * 1.8));

  const sideForBracket: OrderSide = action === 'SELL' ? 'SELL' : 'BUY';
  const entryRef = sideForBracket === 'BUY' ? instrument.ask : instrument.bid;
  const stopLoss = round2(
    sideForBracket === 'BUY' ? entryRef - effectiveSl : entryRef + effectiveSl,
  );
  const takeProfit = round2(
    sideForBracket === 'BUY' ? entryRef + effectiveTp : entryRef - effectiveTp,
  );

  return {
    action,
    confidence,
    reason,
    stopLoss,
    takeProfit,
    indicators: {
      ema9: round2(ema9),
      ema21: round2(ema21),
      vwap: round2(vwap),
      rsi14: Number(rsi14.toFixed(1)),
      orHigh: orb?.orHigh ?? null,
      orLow: orb?.orLow ?? null,
    },
    orderFlow: flow
      ? {
          buyPressurePct: flow.buyPressurePct,
          bookImbalancePct: flow.bookImbalancePct,
          cvd: flow.cvd,
          pocPrice: flow.pocPrice,
          vahPrice: flow.vahPrice,
          valPrice: flow.valPrice,
          atr14: flow.atr14,
          verdict: flow.verdict,
        }
      : null,
    mtfTrends,
    mtfBias,
    macro,
    sessionInfo,
    newsStatus: {
      blocked: newsBlocked,
      activeEvent: activeNewsEvent,
      nextEvent: nextNewsEvent,
      minutesUntilNext,
      reason: newsReason,
    },
  };
}

export interface StrategyStatRow {
  strategy: XauBotStrategy;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  profitFactor: number;
}

export interface BotEquityPoint {
  index: number;
  timestamp: number;
  tradeNet: number;
  cumNet: number;
  side: OrderSide;
  strategy: XauBotStrategy;
}

export interface XauBotAnalyticsSummary {
  closedCount: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedGrossPnl: number;
  totalFees: number;
  realizedNetPnl: number;
  openUnrealizedPnl: number;
  totalNetPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  currentStreak: number;
  equityCurve: BotEquityPoint[];
  strategyBreakdown: StrategyStatRow[];
}

export const STRATEGY_LABELS: Record<XauBotStrategy, string> = {
  ORB_VWAP: 'ORB Breakout + VWAP',
  EMA_MOMENTUM: 'EMA 9/21 + VWAP + RSI',
  BOLLINGER_REVERSION: 'Bollinger + RSI Reversion',
  ORDERFLOW_LIQUIDITY: 'Order Flow + POC/Liquidity',
};

export function computeXauBotStats(
  closedTrades: XauBotTradeRecord[],
  openBotPositions: Position[],
  xauInstrument: Instrument | null,
): XauBotAnalyticsSummary {
  const chronological = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);

  let realizedGrossPnl = 0;
  let totalFees = 0;
  let realizedNetPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let bestTrade = 0;
  let worstTrade = 0;
  let cumNet = 0;
  let peakCum = 0;
  let maxDrawdown = 0;
  let currentStreak = 0;

  const equityCurve: BotEquityPoint[] = [];

  chronological.forEach((t, idx) => {
    realizedGrossPnl += t.grossPnl;
    totalFees += t.fee;
    realizedNetPnl += t.netPnl;

    if (t.netPnl > 0) {
      wins += 1;
      grossProfit += t.netPnl;
      currentStreak = currentStreak >= 0 ? currentStreak + 1 : 1;
    } else if (t.netPnl < 0) {
      losses += 1;
      grossLoss += Math.abs(t.netPnl);
      currentStreak = currentStreak <= 0 ? currentStreak - 1 : -1;
    }

    if (idx === 0 || t.netPnl > bestTrade) bestTrade = t.netPnl;
    if (idx === 0 || t.netPnl < worstTrade) worstTrade = t.netPnl;

    cumNet = round2(cumNet + t.netPnl);
    if (cumNet > peakCum) peakCum = cumNet;
    const dd = round2(peakCum - cumNet);
    if (dd > maxDrawdown) maxDrawdown = dd;

    equityCurve.push({
      index: idx + 1,
      timestamp: t.closedAt,
      tradeNet: round2(t.netPnl),
      cumNet,
      side: t.side,
      strategy: t.strategy,
    });
  });

  const openUnrealizedPnl = xauInstrument
    ? openBotPositions.reduce((acc, p) => acc + computeUnrealizedPnl(p, xauInstrument), 0)
    : 0;

  const totalNetPnl = round2(realizedNetPnl + openUnrealizedPnl);
  const closedCount = chronological.length;
  const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 3.5 : 0;
  const expectancy = closedCount > 0 ? realizedNetPnl / closedCount : 0;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;

  const strategies: XauBotStrategy[] = [
    'ORB_VWAP',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
    'ORDERFLOW_LIQUIDITY',
  ];

  const strategyBreakdown: StrategyStatRow[] = strategies.map((strat) => {
    const rows = chronological.filter((t) => t.strategy === strat);
    const sWins = rows.filter((r) => r.netPnl > 0).length;
    const sLosses = rows.filter((r) => r.netPnl < 0).length;
    const sNet = rows.reduce((a, r) => a + r.netPnl, 0);
    const sGrossWin = rows
      .filter((r) => r.netPnl > 0)
      .reduce((a, r) => a + r.netPnl, 0);
    const sGrossLoss = Math.abs(
      rows.filter((r) => r.netPnl < 0).reduce((a, r) => a + r.netPnl, 0),
    );
    return {
      strategy: strat,
      label: STRATEGY_LABELS[strat],
      trades: rows.length,
      wins: sWins,
      losses: sLosses,
      winRate: rows.length > 0 ? (sWins / rows.length) * 100 : 0,
      netPnl: round2(sNet),
      avgPnl: rows.length > 0 ? round2(sNet / rows.length) : 0,
      profitFactor:
        sGrossLoss > 0 ? sGrossWin / sGrossLoss : sGrossWin > 0 ? 3.5 : 0,
    };
  });

  return {
    closedCount,
    wins,
    losses,
    winRate,
    realizedGrossPnl: round2(realizedGrossPnl),
    totalFees: round2(totalFees),
    realizedNetPnl: round2(realizedNetPnl),
    openUnrealizedPnl: round2(openUnrealizedPnl),
    totalNetPnl,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor,
    expectancy: round2(expectancy),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    bestTrade: round2(bestTrade),
    worstTrade: round2(worstTrade),
    maxDrawdown: round2(maxDrawdown),
    currentStreak,
    equityCurve,
    strategyBreakdown,
  };
}

export function adaptBotFromTradeHistory(
  current: XauBotConfig,
  closedTrades: XauBotTradeRecord[],
): {
  nextConfig: XauBotConfig;
  event: XauBotAdaptationEvent | null;
} {
  if (closedTrades.length < 2) {
    return {nextConfig: current, event: null};
  }

  const chronological = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);
  const recent = chronological.slice(-5);
  const recentWins = recent.filter((t) => t.netPnl > 0).length;
  const recentWinRate = (recentWins / recent.length) * 100;

  // Count trailing consecutive wins / losses
  let trailingLosses = 0;
  let trailingWins = 0;
  for (let i = chronological.length - 1; i >= 0; i--) {
    if (chronological[i].netPnl < 0 && trailingWins === 0) trailingLosses += 1;
    else if (chronological[i].netPnl > 0 && trailingLosses === 0) trailingWins += 1;
    else break;
  }

  const next: XauBotConfig = {...current};
  const changes: string[] = [];
  const reasons: string[] = [];

  // 1. Strategy rotation based on realized expectancy / exploration
  const strategies: XauBotStrategy[] = [
    'ORB_VWAP',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
    'ORDERFLOW_LIQUIDITY',
  ];
  const byStrat = strategies.map((s) => {
    const rows = chronological.filter((t) => t.strategy === s);
    const net = rows.reduce((a, r) => a + r.netPnl, 0);
    return {
      strategy: s,
      count: rows.length,
      net,
      avg: rows.length > 0 ? net / rows.length : 0,
    };
  });
  const curStat = byStrat.find((x) => x.strategy === current.strategy)!;
  if (curStat.count >= 2 && (curStat.net < 0 || trailingLosses >= 2)) {
    const betterTested = byStrat
      .filter((x) => x.strategy !== current.strategy && x.count >= 2 && x.avg > curStat.avg)
      .sort((a, b) => b.avg - a.avg)[0];
    const untried = byStrat.find((x) => x.strategy !== current.strategy && x.count === 0);
    const candidate = betterTested || untried;
    if (candidate) {
      next.strategy = candidate.strategy;
      changes.push(`Strategy: ${current.strategy} -> ${candidate.strategy}`);
      reasons.push(
        betterTested
          ? `${candidate.strategy} shows stronger avg expectancy (${round2(candidate.avg)} vs ${round2(curStat.avg)} USD/trade)`
          : `${current.strategy} underperformed (${round2(curStat.net)} USD); rotating to test ${candidate.strategy}`,
      );
    }
  }

  // 2. Confidence threshold tuning
  if ((recent.length >= 3 && recentWinRate < 45) || trailingLosses >= 2) {
    const raised = Math.min(85, current.minConfidence + 5);
    if (raised !== current.minConfidence) {
      next.minConfidence = raised;
      changes.push(`Min Confidence: ${current.minConfidence}% -> ${raised}%`);
      reasons.push(`Recent win rate ${recentWinRate.toFixed(0)}% triggered stricter signal filtering`);
    }
  } else if (recent.length >= 4 && recentWinRate >= 70 && current.minConfidence > 50) {
    const eased = Math.max(50, current.minConfidence - 5);
    if (eased !== current.minConfidence) {
      next.minConfidence = eased;
      changes.push(`Min Confidence: ${current.minConfidence}% -> ${eased}%`);
      reasons.push(`High recent win rate (${recentWinRate.toFixed(0)}%) allows slightly more entries`);
    }
  }

  // 3. Stop-Loss / Take-Profit & Trailing Stop calibration
  const slHits = recent.filter((t) => t.exitAction === 'STOP_LOSS').length;
  const tpHits = recent.filter((t) => t.exitAction === 'TAKE_PROFIT').length;

  if (slHits >= 2 && slHits > tpHits) {
    const widerSl = Math.min(18, round2(current.stopLossDollars + 1.5));
    if (widerSl !== current.stopLossDollars) {
      next.stopLossDollars = widerSl;
      changes.push(`Stop-Loss: $${current.stopLossDollars} -> $${widerSl}/oz`);
      reasons.push(`${slHits} recent Stop-Loss exits; widening stop buffer against gold wicks`);
    }
    const targetTp = Math.max(current.takeProfitDollars, round2(widerSl * 1.8));
    if (targetTp !== current.takeProfitDollars) {
      next.takeProfitDollars = Math.min(36, targetTp);
      changes.push(`Take-Profit: $${current.takeProfitDollars} -> $${next.takeProfitDollars}/oz`);
    }
    const trail = round2(Math.max(5, next.stopLossDollars * 0.75));
    if (current.trailingStopDollars !== trail) {
      next.trailingStopDollars = trail;
      changes.push(
        `Trailing Stop: ${current.trailingStopDollars ?? 'Off'} -> $${trail}/oz`,
      );
    }
  } else if (tpHits >= 2 && recentWinRate >= 60) {
    const extendedTp = Math.min(32, round2(current.takeProfitDollars + 2));
    if (extendedTp !== current.takeProfitDollars) {
      next.takeProfitDollars = extendedTp;
      changes.push(`Take-Profit: $${current.takeProfitDollars} -> $${extendedTp}/oz`);
      reasons.push(`Strong TP capture (${tpHits} recent hits); extending reward target`);
    }
  }

  // 4. Risk-adjusted Lot Sizing (defensive drawdown cut / winner scaling)
  if (trailingLosses >= 2 && current.lotSize > 0.05) {
    const reducedLot = Math.max(0.05, Number((current.lotSize * 0.8).toFixed(2)));
    if (reducedLot !== current.lotSize) {
      next.lotSize = reducedLot;
      changes.push(`Lot Size: ${current.lotSize} -> ${reducedLot}`);
      reasons.push(`Defensive position scaling after ${trailingLosses} consecutive losses`);
    }
  } else if (trailingWins >= 3 && current.lotSize < 0.35) {
    const scaledLot = Math.min(0.35, Number((current.lotSize + 0.05).toFixed(2)));
    if (scaledLot !== current.lotSize) {
      next.lotSize = scaledLot;
      changes.push(`Lot Size: ${current.lotSize} -> ${scaledLot}`);
      reasons.push(`Compounding position size after ${trailingWins} consecutive wins`);
    }
  }

  // 5. Multi-Trade Concurrency Tuning (scale up runners in winning regimes, cut in drawdowns)
  if (trailingWins >= 2 && recentWinRate >= 65 && current.maxConcurrentPositions < 5) {
    const expandedSlots = Math.min(5, current.maxConcurrentPositions + 1);
    if (expandedSlots !== current.maxConcurrentPositions) {
      next.maxConcurrentPositions = expandedSlots;
      changes.push(`Max Trades: ${current.maxConcurrentPositions} -> ${expandedSlots}`);
      reasons.push(`Winning momentum (${recentWinRate.toFixed(0)}% win rate) unlocks extra runner slot`);
    }
  } else if (trailingLosses >= 2 && current.maxConcurrentPositions > 2) {
    const reducedSlots = Math.max(2, current.maxConcurrentPositions - 1);
    if (reducedSlots !== current.maxConcurrentPositions) {
      next.maxConcurrentPositions = reducedSlots;
      changes.push(`Max Trades: ${current.maxConcurrentPositions} -> ${reducedSlots}`);
      reasons.push(`Tightening concurrent exposure after ${trailingLosses} consecutive losses`);
    }
  }

  if (changes.length === 0) {
    return {nextConfig: current, event: null};
  }

  const event: XauBotAdaptationEvent = {
    id: `adapt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    triggerTradeCount: chronological.length,
    summary: changes.join(' · '),
    changes,
    reason: reasons.join('; '),
  };

  return {nextConfig: next, event};
}
