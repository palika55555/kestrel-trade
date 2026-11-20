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
  BacktestReport,
  BacktestStrategyResult,
  Candle,
  EconomicCalendarSnapshot,
  EconomicEvent,
  GoldMarketRegime,
  InstitutionalGoldContext,
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
    useKillzonesOnly: false,
    useAtrRiskScaling: true,
    riskPerTradePct: 0,
    antiTiltCooldownMinutes: 15,
    staleTradeMinutes: 45,
    newsPauseMinutesBefore: 15,
    newsPauseMinutesAfter: 15,
    maxSpreadDollars: 1.2,
    autoBreakEvenEnabled: true,
    partialTpEnabled: true,
    strategy: 'SMART_ENSEMBLE',
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

export interface AntiTiltStatus {
  active: boolean;
  trailingLosses: number;
  cooldownRemainingSec: number;
  defensiveLotMultiplier: number;
}

export function isInsideLondonOrNyKillzone(nowMs: number = Date.now()): {
  inKillzone: boolean;
  label: string;
} {
  const d = new Date(nowMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  // London Open Killzone: 07:00 - 11:00 UTC
  if (mins >= 420 && mins <= 660) {
    return {inKillzone: true, label: 'London Killzone'};
  }
  // NY Open & Overlap Killzone: 12:30 - 17:30 UTC
  if (mins >= 750 && mins <= 1050) {
    return {inKillzone: true, label: 'NY Open Killzone'};
  }
  return {inKillzone: false, label: 'Off-Killzone'};
}

export function checkAntiTiltState(
  closedTrades: XauBotTradeRecord[],
  config: XauBotConfig,
  nowMs: number = Date.now(),
): AntiTiltStatus {
  if (!closedTrades || closedTrades.length === 0) {
    return {active: false, trailingLosses: 0, cooldownRemainingSec: 0, defensiveLotMultiplier: 1};
  }
  const sorted = [...closedTrades].sort((a, b) => b.closedAt - a.closedAt);
  let trailingLosses = 0;
  for (const t of sorted) {
    if (t.netPnl < 0) trailingLosses += 1;
    else break;
  }
  if (trailingLosses < 2) {
    return {active: false, trailingLosses, cooldownRemainingSec: 0, defensiveLotMultiplier: 1};
  }
  const cooldownMin = Math.max(0, config.antiTiltCooldownMinutes ?? 15);
  const lastLossAt = sorted[0].closedAt;
  const elapsedMs = Math.max(0, nowMs - lastLossAt);
  const cooldownMs = cooldownMin * 60_000;
  const remainingSec = elapsedMs < cooldownMs ? Math.ceil((cooldownMs - elapsedMs) / 1000) : 0;

  return {
    active: remainingSec > 0,
    trailingLosses,
    cooldownRemainingSec: remainingSec,
    defensiveLotMultiplier: trailingLosses >= 3 ? 0.5 : 0.65,
  };
}

export function computeEffectiveBotLot(
  config: XauBotConfig,
  effectiveSlDollars: number,
  accountEquity: number,
  closedTrades: XauBotTradeRecord[] = [],
  nowMs: number = Date.now(),
): number {
  const antiTilt = checkAntiTiltState(closedTrades, config, nowMs);
  const riskPct = config.riskPerTradePct ?? 0;
  let baseLot = config.lotSize;
  if (riskPct > 0 && accountEquity > 0 && effectiveSlDollars > 0) {
    const riskDollars = accountEquity * (Math.min(5, riskPct) / 100);
    // 1.0 lot XAU/USD = 100 oz -> $100 per $1 move
    baseLot = riskDollars / (effectiveSlDollars * 100);
  }
  const adjusted = baseLot * antiTilt.defensiveLotMultiplier;
  return Math.max(0.01, Math.min(5.0, Math.round(adjusted * 100) / 100));
}

export function shouldEarlyExitPosition(
  pos: Position,
  markPrice: number,
  contractSize: number,
  evaluation: XauBotEvaluation | null,
  staleTradeMinutes: number = 45,
  nowMs: number = Date.now(),
): {exit: boolean; reason?: string} {
  if (!evaluation || staleTradeMinutes <= 0) return {exit: false};
  const heldMs = nowMs - pos.openedAt;
  if (heldMs < staleTradeMinutes * 60_000) return {exit: false};

  const diff = pos.side === 'BUY' ? markPrice - pos.entryPrice : pos.entryPrice - markPrice;
  const unrealGross = diff * pos.quantity * contractSize;
  if (unrealGross >= 0) return {exit: false}; // Let runners & breakeven trades breathe

  const oppositeAction = pos.side === 'BUY' ? 'SELL' : 'BUY';
  const oppositeMtf = pos.side === 'BUY' ? 'BEARISH' : 'BULLISH';

  if (evaluation.action === oppositeAction && evaluation.confidence >= 64) {
    return {
      exit: true,
      reason: `Early Exit (${Math.round(heldMs / 60_000)}m stagnant): signal flipped ${oppositeAction} (${evaluation.confidence}%)`,
    };
  }
  if (
    evaluation.mtfBias === oppositeMtf &&
    evaluation.orderFlow &&
    ((pos.side === 'BUY' && evaluation.orderFlow.buyPressurePct <= 42) ||
      (pos.side === 'SELL' && evaluation.orderFlow.buyPressurePct >= 58))
  ) {
    return {
      exit: true,
      reason: `Time-Stop (${Math.round(heldMs / 60_000)}m): MTF & Order Flow turned ${oppositeMtf}`,
    };
  }
  return {exit: false};
}

export function detectGoldMarketRegime(
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
  const efficiencyRatio = pathSum > 0 ? netMove / pathSum : 0;
  const price = slice[slice.length - 1].close || 1;
  const bbWidthPct = ((bbUpper - bbLower) / price) * 100;
  const emaGap = Math.abs(ema9 - ema21);

  if ((rsi14 >= 70 || rsi14 <= 30) && bbWidthPct >= 0.45) {
    return 'VOLATILE_REVERSAL';
  }
  if (efficiencyRatio >= 0.42 && emaGap >= Math.max(0.4, atr14 * 0.28)) {
    return 'TRENDING';
  }
  if (bbWidthPct <= 0.32 || (efficiencyRatio >= 0.34 && netMove >= atr14 * 1.4)) {
    return 'BREAKOUT';
  }
  return 'RANGING';
}

export interface XauBotEvaluation {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  selectedSubStrategy?: XauBotStrategy;
  regime: GoldMarketRegime;
  effectiveSlDollars: number;
  effectiveTpDollars: number;
  effectiveLotSize: number;
  antiTilt: AntiTiltStatus;
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
  institutional: InstitutionalGoldContext | null;
  atasSignals: {
    stackedImbalance: string;
    absorptionSignal: string;
    cvdDivergence: string;
  } | null;
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
    institutional?: InstitutionalGoldContext | null;
    calendar?: EconomicCalendarSnapshot | null;
    closedTrades?: XauBotTradeRecord[];
    accountEquity?: number;
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
  const instCtx = context?.institutional ?? null;
  const flow = analyzeOrderFlow(
    instrument,
    candles,
    recentPrints,
    pendingOrders,
    instCtx,
  );

  const atrEst = flow?.atr14 && flow.atr14 > 0 ? flow.atr14 : 2.2;
  const regime = detectGoldMarketRegime(
    candles,
    ema9,
    ema21,
    bbUpper,
    bbLower,
    rsi14,
    atrEst,
  );
  const nowMs = context?.nowMs ?? Date.now();
  const antiTilt = checkAntiTiltState(context?.closedTrades ?? [], config, nowMs);

  // Sub-strategy evaluator helper so individual strategies & SMART_ENSEMBLE share the exact same engines
  const evalSubStrategy = (
    strat: Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>,
  ): {action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string} => {
    if (strat === 'ORB_VWAP') {
      if (!orb) return {action: 'HOLD', confidence: 40, reason: 'Warming up ORB window...'};
      const conf = orb.confidenceScore;
      if (
        (orb.signal === 'LONG_BREAKOUT' || orb.signal === 'LONG_RETEST') &&
        instrument.price >= vwap &&
        conf >= Math.min(config.minConfidence, 55)
      ) {
        return {
          action: 'BUY',
          confidence: conf,
          reason: `${orb.signal.replace('_', ' ')} above OR High (${formatPrice(orb.orHigh, 2)}) & VWAP (${formatPrice(vwap, 2)})`,
        };
      }
      if (
        (orb.signal === 'SHORT_BREAKOUT' || orb.signal === 'SHORT_RETEST') &&
        instrument.price <= vwap &&
        conf >= Math.min(config.minConfidence, 55)
      ) {
        return {
          action: 'SELL',
          confidence: conf,
          reason: `${orb.signal.replace('_', ' ')} below OR Low (${formatPrice(orb.orLow, 2)}) & VWAP (${formatPrice(vwap, 2)})`,
        };
      }
      return {
        action: 'HOLD',
        confidence: Math.min(54, conf),
        reason: `ORB ${orb.signal.replace('_', ' ')} (${conf}%)`,
      };
    }

    if (strat === 'EMA_MOMENTUM') {
      const bullishCross = prevEma9 <= prevEma21 && ema9 > ema21;
      const bearishCross = prevEma9 >= prevEma21 && ema9 < ema21;
      const bullishTrend = ema9 > ema21 && instrument.price > vwap && rsi14 >= 52 && rsi14 <= 72;
      const bearishTrend = ema9 < ema21 && instrument.price < vwap && rsi14 <= 48 && rsi14 >= 28;
      if (bullishCross || bullishTrend) {
        return {
          action: 'BUY',
          confidence: bullishCross ? 84 : 68,
          reason: `EMA9 (${formatPrice(ema9, 2)}) > EMA21 (${formatPrice(ema21, 2)}), above VWAP, RSI ${rsi14.toFixed(1)}`,
        };
      }
      if (bearishCross || bearishTrend) {
        return {
          action: 'SELL',
          confidence: bearishCross ? 84 : 68,
          reason: `EMA9 (${formatPrice(ema9, 2)}) < EMA21 (${formatPrice(ema21, 2)}), below VWAP, RSI ${rsi14.toFixed(1)}`,
        };
      }
      return {
        action: 'HOLD',
        confidence: 42,
        reason: `Neutral momentum: EMA9 ${formatPrice(ema9, 2)} vs EMA21 ${formatPrice(ema21, 2)} · RSI ${rsi14.toFixed(1)}`,
      };
    }

    if (strat === 'BOLLINGER_REVERSION') {
      if (instrument.price <= bbLower && rsi14 <= 36) {
        return {
          action: 'BUY',
          confidence: 78,
          reason: `Lower Bollinger touch (${formatPrice(bbLower, 2)}) with oversold RSI ${rsi14.toFixed(1)}`,
        };
      }
      if (instrument.price >= bbUpper && rsi14 >= 64) {
        return {
          action: 'SELL',
          confidence: 78,
          reason: `Upper Bollinger touch (${formatPrice(bbUpper, 2)}) with overbought RSI ${rsi14.toFixed(1)}`,
        };
      }
      return {
        action: 'HOLD',
        confidence: 45,
        reason: `Inside Bollinger (${formatPrice(bbLower, 2)}–${formatPrice(bbUpper, 2)}), RSI ${rsi14.toFixed(1)}`,
      };
    }

    if (strat === 'ORDERFLOW_LIQUIDITY' && flow) {
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
        return {
          action: 'BUY',
          confidence: flow.verdict === 'STRONG_BUY' ? 84 : 70,
          reason: `Order Flow Buy ${flow.buyPressurePct}% · Book Bids ${flow.bookImbalancePct}% · POC ${formatPrice(flow.pocPrice, 2)}`,
        };
      }
      if (
        flow.sellPressurePct >= 56 &&
        flow.bookImbalancePct <= 50 &&
        (flow.verdict === 'STRONG_SELL' || nearResistance || instrument.price < flow.pocPrice)
      ) {
        return {
          action: 'SELL',
          confidence: flow.verdict === 'STRONG_SELL' ? 84 : 70,
          reason: `Order Flow Sell ${flow.sellPressurePct}% · Book Asks ${100 - flow.bookImbalancePct}% · POC ${formatPrice(flow.pocPrice, 2)}`,
        };
      }
      return {
        action: 'HOLD',
        confidence: Math.max(40, Math.min(62, flow.verdictScore)),
        reason: `Balanced flow (${flow.buyPressurePct}% Buy / ${flow.bookImbalancePct}% Bid) around POC ${formatPrice(flow.pocPrice, 2)}`,
      };
    }

    // LIQUIDITY_SWEEP_SMC: Detects stop-run sweeps beyond 20-bar BSL/SSL + rejection wick + ATAS absorption/CVD divergence
    const sweepLookback = candles.slice(-26, -2);
    if (sweepLookback.length >= 10) {
      let swingHigh = -Infinity;
      let swingLow = Infinity;
      for (const c of sweepLookback) {
        if (c.high > swingHigh) swingHigh = c.high;
        if (c.low < swingLow) swingLow = c.low;
      }
      const recent2 = candles.slice(-2);
      const sweptLow = Math.min(...recent2.map((c) => c.low));
      const sweptHigh = Math.max(...recent2.map((c) => c.high));
      const latest = candles[idx];
      const body = Math.abs(latest.close - latest.open);
      const lowerWick = Math.min(latest.open, latest.close) - latest.low;
      const upperWick = latest.high - Math.max(latest.open, latest.close);

      const bullSweep =
        sweptLow < swingLow - atrEst * 0.08 &&
        latest.close > swingLow &&
        (latest.close > latest.open || lowerWick > body * 1.1);
      const bearSweep =
        sweptHigh > swingHigh + atrEst * 0.08 &&
        latest.close < swingHigh &&
        (latest.close < latest.open || upperWick > body * 1.1);

      if (bullSweep) {
        let conf = 74;
        if (flow?.absorptionSignal === 'BULLISH_ABSORPTION' || flow?.cvdDivergence === 'BULLISH') conf += 10;
        if (rsi14 <= 46) conf += 4;
        return {
          action: 'BUY',
          confidence: Math.min(92, conf),
          reason: `SMC SSL Sweep below ${formatPrice(swingLow, 2)} & reclaim (${formatPrice(latest.close, 2)})`,
        };
      }
      if (bearSweep) {
        let conf = 74;
        if (flow?.absorptionSignal === 'BEARISH_ABSORPTION' || flow?.cvdDivergence === 'BEARISH') conf += 10;
        if (rsi14 >= 54) conf += 4;
        return {
          action: 'SELL',
          confidence: Math.min(92, conf),
          reason: `SMC BSL Sweep above ${formatPrice(swingHigh, 2)} & reject (${formatPrice(latest.close, 2)})`,
        };
      }
      return {
        action: 'HOLD',
        confidence: 42,
        reason: `SMC Range ${formatPrice(swingLow, 2)}–${formatPrice(swingHigh, 2)} (no sweep)`,
      };
    }

    return {action: 'HOLD', confidence: 40, reason: 'Monitoring live XAU/USD ticks...'};
  };

  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 40;
  let reason = 'Monitoring live XAU/USD ticks...';
  let selectedSubStrategy: XauBotStrategy = config.strategy;

  if (config.strategy === 'SMART_ENSEMBLE') {
    const subList: Array<Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>> = [
      'ORB_VWAP',
      'LIQUIDITY_SWEEP_SMC',
      'ORDERFLOW_LIQUIDITY',
      'EMA_MOMENTUM',
      'BOLLINGER_REVERSION',
    ];
    const regimeBonus = (s: Exclude<XauBotStrategy, 'SMART_ENSEMBLE'>): number => {
      if (regime === 'TRENDING') return s === 'EMA_MOMENTUM' || s === 'ORB_VWAP' ? 8 : s === 'BOLLINGER_REVERSION' ? -8 : 0;
      if (regime === 'BREAKOUT') return s === 'ORB_VWAP' || s === 'ORDERFLOW_LIQUIDITY' ? 8 : s === 'BOLLINGER_REVERSION' ? -6 : 0;
      if (regime === 'RANGING') return s === 'BOLLINGER_REVERSION' || s === 'ORDERFLOW_LIQUIDITY' ? 8 : s === 'EMA_MOMENTUM' ? -6 : 0;
      return s === 'LIQUIDITY_SWEEP_SMC' || s === 'BOLLINGER_REVERSION' ? 9 : -3; // VOLATILE_REVERSAL
    };

    const evaluated = subList.map((s) => {
      const res = evalSubStrategy(s);
      const weightedConf = res.action === 'HOLD' ? res.confidence : Math.max(20, Math.min(96, res.confidence + regimeBonus(s)));
      return {strategy: s, ...res, weightedConf};
    });

    const activeSignals = evaluated.filter((e) => e.action !== 'HOLD');
    const buyVotes = activeSignals.filter((e) => e.action === 'BUY');
    const sellVotes = activeSignals.filter((e) => e.action === 'SELL');

    if (activeSignals.length === 0) {
      const bestHold = [...evaluated].sort((a, b) => b.confidence - a.confidence)[0];
      action = 'HOLD';
      confidence = bestHold.confidence;
      reason = `[${regime}] Ensemble scanning (${bestHold.reason})`;
    } else if (buyVotes.length > 0 && sellVotes.length > 0 && buyVotes.length === sellVotes.length) {
      action = 'HOLD';
      confidence = 46;
      reason = `[${regime}] Conflicting strategies (${buyVotes.length} BUY vs ${sellVotes.length} SELL) — skipped`;
    } else {
      const dominantSide = buyVotes.length >= sellVotes.length ? 'BUY' : 'SELL';
      const winners = (dominantSide === 'BUY' ? buyVotes : sellVotes).sort(
        (a, b) => b.weightedConf - a.weightedConf,
      );
      const top = winners[0];
      selectedSubStrategy = top.strategy;
      action = top.action;
      const consensusBoost = winners.length >= 2 ? Math.min(10, (winners.length - 1) * 5) : 0;
      const conflictPenalty = (dominantSide === 'BUY' ? sellVotes.length : buyVotes.length) * 6;
      confidence = Math.max(25, Math.min(96, top.weightedConf + consensusBoost - conflictPenalty));
      reason = `[${regime} · ${winners.length}/${subList.length} agree] ${top.reason}`;
    }
  } else {
    const single = evalSubStrategy(config.strategy);
    action = single.action;
    confidence = single.confidence;
    reason = single.reason;
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

  // 3b. ATAS Footprint / Absorption / Divergence + Institutional Smart Money Gate
  if (flow && useOrderFlow && action !== 'HOLD') {
    if (
      (action === 'BUY' && flow.stackedImbalance === 'BULLISH_STACK') ||
      (action === 'SELL' && flow.stackedImbalance === 'BEARISH_STACK')
    ) {
      confidence = Math.min(98, confidence + 4);
      reason = `${reason} · ATAS Stack`;
    } else if (
      (action === 'BUY' && flow.stackedImbalance === 'BEARISH_STACK') ||
      (action === 'SELL' && flow.stackedImbalance === 'BULLISH_STACK')
    ) {
      confidence = Math.max(18, confidence - 8);
      reason = `${reason} · Opposing Stack`;
    }

    if (
      (action === 'BUY' &&
        (flow.absorptionSignal === 'BULLISH_ABSORPTION' || flow.cvdDivergence === 'BULLISH')) ||
      (action === 'SELL' &&
        (flow.absorptionSignal === 'BEARISH_ABSORPTION' || flow.cvdDivergence === 'BEARISH'))
    ) {
      confidence = Math.min(98, confidence + 4);
      reason = `${reason} · ${flow.absorptionSignal !== 'NONE' ? 'Absorption' : 'CVD Div'}`;
    } else if (
      (action === 'BUY' &&
        (flow.absorptionSignal === 'BEARISH_ABSORPTION' || flow.cvdDivergence === 'BEARISH')) ||
      (action === 'SELL' &&
        (flow.absorptionSignal === 'BULLISH_ABSORPTION' || flow.cvdDivergence === 'BULLISH'))
    ) {
      confidence = Math.max(18, confidence - 6);
      reason = `${reason} · Flow Divergence Risk`;
    }
  }

  if (instCtx && useOrderFlow && action !== 'HOLD') {
    if (action === 'BUY' && instCtx.paxgBuyPct >= 58 && instCtx.paxgBookBidPct >= 52) {
      confidence = Math.min(98, confidence + 6);
      reason = `${reason} · PAXG + (${instCtx.paxgBuyPct}% Buy)`;
    } else if (action === 'BUY' && instCtx.paxgBuyPct <= 38 && instCtx.paxgBookBidPct <= 44) {
      confidence = Math.max(18, confidence - 9);
      reason = `${reason} · PAXG Seller pressure`;
    } else if (action === 'SELL' && instCtx.paxgBuyPct <= 42 && instCtx.paxgBookBidPct <= 48) {
      confidence = Math.min(98, confidence + 6);
      reason = `${reason} · PAXG + (${100 - instCtx.paxgBuyPct}% Sell)`;
    } else if (action === 'SELL' && instCtx.paxgBuyPct >= 62 && instCtx.paxgBookBidPct >= 56) {
      confidence = Math.max(18, confidence - 9);
      reason = `${reason} · PAXG Buyer pressure`;
    }
  }

  if (instCtx && useMacro && action !== 'HOLD') {
    if (
      (action === 'BUY' && instCtx.compositeBias === 'BULLISH') ||
      (action === 'SELL' && instCtx.compositeBias === 'BEARISH')
    ) {
      confidence = Math.min(98, confidence + 4);
      reason = `${reason} · Insider +`;
    } else if (
      (action === 'BUY' && instCtx.compositeBias === 'BEARISH') ||
      (action === 'SELL' && instCtx.compositeBias === 'BULLISH')
    ) {
      confidence = Math.max(18, confidence - 4);
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

  // 4b. Killzone Only Guard (optional focus on London Open & NY Open high-edge hours)
  if ((config.useKillzonesOnly ?? false) && action !== 'HOLD') {
    const kz = isInsideLondonOrNyKillzone(nowMs);
    if (!kz.inKillzone) {
      reason = `Killzone Guard paused ${action}: waiting for London (07–11 UTC) or NY (12:30–17:30 UTC)`;
      action = 'HOLD';
      confidence = Math.min(confidence, 42);
    }
  }

  // 4c. Anti-Tilt Loss-Streak Cooldown Guard
  if (antiTilt.active && action !== 'HOLD') {
    reason = `Anti-Tilt Guard paused ${action} (${antiTilt.trailingLosses} losses in row, ${Math.ceil(
      antiTilt.cooldownRemainingSec / 60,
    )}m cooldown left)`;
    action = 'HOLD';
    confidence = Math.min(confidence, 38);
  }

  // 5. Economic Calendar News Guard (pauses entries around High-Impact USD events)
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

  const effectiveMinConf = instCtx?.volatilityAlert
    ? Math.min(90, config.minConfidence + 5)
    : config.minConfidence;

  if (confidence < effectiveMinConf && action !== 'HOLD') {
    reason = `Signal suppressed (${confidence}% < min ${effectiveMinConf}%${
      instCtx?.volatilityAlert ? ' GVZ spike' : ''
    }): ${reason}`;
    action = 'HOLD';
  }

  // ATR-aware SL & proportional TP scaling (protects against gold noise spikes)
  const useAtrRisk = config.useAtrRiskScaling ?? true;
  const effectiveSl =
    useAtrRisk && flow && flow.atr14 > 0
      ? Math.min(22, Math.max(config.stopLossDollars, round2(flow.atr14 * 1.25)))
      : config.stopLossDollars;
  const effectiveTp = Math.max(config.takeProfitDollars, round2(effectiveSl * 1.9));
  const effectiveLotSize = computeEffectiveBotLot(
    config,
    effectiveSl,
    context?.accountEquity ?? 100_000,
    context?.closedTrades ?? [],
    nowMs,
  );

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
    selectedSubStrategy,
    regime,
    effectiveSlDollars: effectiveSl,
    effectiveTpDollars: effectiveTp,
    effectiveLotSize,
    antiTilt,
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
    institutional: instCtx,
    atasSignals: flow
      ? {
          stackedImbalance: flow.stackedImbalance,
          absorptionSignal: flow.absorptionSignal,
          cvdDivergence: flow.cvdDivergence,
        }
      : null,
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
  SMART_ENSEMBLE: 'Smart Regime Ensemble',
  ORB_VWAP: 'ORB Breakout + VWAP',
  LIQUIDITY_SWEEP_SMC: 'Liquidity Sweep + FVG',
  ORDERFLOW_LIQUIDITY: 'Order Flow + POC/Liquidity',
  EMA_MOMENTUM: 'EMA 9/21 + VWAP + RSI',
  BOLLINGER_REVERSION: 'Bollinger + RSI Reversion',
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
    'SMART_ENSEMBLE',
    'ORB_VWAP',
    'LIQUIDITY_SWEEP_SMC',
    'ORDERFLOW_LIQUIDITY',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
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
    'SMART_ENSEMBLE',
    'ORB_VWAP',
    'LIQUIDITY_SWEEP_SMC',
    'ORDERFLOW_LIQUIDITY',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
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

export function runWalkForwardBacktest(
  instrument: Instrument,
  candles: Candle[],
  baseConfig: XauBotConfig,
  timeframeLabel: string = '15m',
): BacktestReport {
  const strategies: XauBotStrategy[] = [
    'SMART_ENSEMBLE',
    'ORB_VWAP',
    'LIQUIDITY_SWEEP_SMC',
    'ORDERFLOW_LIQUIDITY',
    'EMA_MOMENTUM',
    'BOLLINGER_REVERSION',
  ];
  const spread = Math.max(0.45, round2(instrument.ask - instrument.bid));
  const halfSpread = spread / 2;
  const lot = Math.max(0.01, baseConfig.lotSize || 0.1);
  const commissionRoundTrip = round2(lot * (instrument.commissionPerUnit || 0.04) * 2);

  const results: BacktestStrategyResult[] = strategies.map((strategy) => {
    const simCfg: XauBotConfig = {
      ...baseConfig,
      strategy,
      useSessionSpreadGuard: false,
      useNewsGuard: false,
      useKillzonesOnly: false,
    };

    let openPos: {
      side: OrderSide;
      entry: number;
      sl: number;
      tp: number;
      beMoved: boolean;
    } | null = null;

    let wins = 0;
    let losses = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let netPnl = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const equityCurve: number[] = [0];

    const startIdx = Math.min(Math.max(25, Math.floor(candles.length * 0.2)), candles.length - 5);
    for (let i = startIdx; i < candles.length; i++) {
      const bar = candles[i];
      const historySlice = candles.slice(0, i + 1);

      // 1. Check SL/TP hit on current bar (worst-case conservative order: SL checked first)
      if (openPos) {
        let exitPrice: number | null = null;
        const tpDist = Math.abs(openPos.tp - openPos.entry);
        if (openPos.side === 'BUY') {
          if (bar.low <= openPos.sl) exitPrice = openPos.sl;
          else if (bar.high >= openPos.tp) exitPrice = openPos.tp;
          else if ((simCfg.autoBreakEvenEnabled ?? true) && !openPos.beMoved && bar.high >= openPos.entry + tpDist * 0.5) {
            openPos.sl = Math.max(openPos.sl, openPos.entry + 0.35);
            openPos.beMoved = true;
          }
        } else {
          if (bar.high >= openPos.sl) exitPrice = openPos.sl;
          else if (bar.low <= openPos.tp) exitPrice = openPos.tp;
          else if ((simCfg.autoBreakEvenEnabled ?? true) && !openPos.beMoved && bar.low <= openPos.entry - tpDist * 0.5) {
            openPos.sl = Math.min(openPos.sl, openPos.entry - 0.35);
            openPos.beMoved = true;
          }
        }

        if (exitPrice !== null) {
          const diff = openPos.side === 'BUY' ? exitPrice - openPos.entry : openPos.entry - exitPrice;
          const tradeNet = round2(diff * lot * instrument.contractSize - commissionRoundTrip);
          netPnl = round2(netPnl + tradeNet);
          if (tradeNet >= 0) {
            wins += 1;
            grossWin += tradeNet;
          } else {
            losses += 1;
            grossLoss += Math.abs(tradeNet);
          }
          if (netPnl > peak) peak = netPnl;
          const dd = round2(peak - netPnl);
          if (dd > maxDrawdown) maxDrawdown = dd;
          equityCurve.push(netPnl);
          openPos = null;
        }
      }

      // 2. Evaluate new signal at bar close if flat
      if (!openPos && i < candles.length - 1) {
        const simInst: Instrument = {
          ...instrument,
          price: bar.close,
          bid: round2(bar.close - halfSpread),
          ask: round2(bar.close + halfSpread),
        };
        const evalRes = evaluateXauBotSignal(simInst, historySlice, simCfg, 15, [], [], {
          nowMs: bar.time * 1000,
        });
        if (evalRes && (evalRes.action === 'BUY' || evalRes.action === 'SELL')) {
          const fill = evalRes.action === 'BUY' ? simInst.ask : simInst.bid;
          openPos = {
            side: evalRes.action,
            entry: fill,
            sl: evalRes.stopLoss,
            tp: evalRes.takeProfit,
            beMoved: false,
          };
        }
      }
    }

    const total = wins + losses;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3.5 : 0;
    const expectancy = total > 0 ? round2(netPnl / total) : 0;

    return {
      strategy,
      label: STRATEGY_LABELS[strategy],
      trades: total,
      wins,
      losses,
      winRate: Number(winRate.toFixed(1)),
      netPnl: round2(netPnl),
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdown: round2(maxDrawdown),
      expectancy,
      equityCurve,
    };
  });

  const sorted = [...results].sort((a, b) => {
    if (a.trades === 0 && b.trades > 0) return 1;
    if (b.trades === 0 && a.trades > 0) return -1;
    return b.netPnl - a.netPnl;
  });

  return {
    symbol: instrument.symbol,
    barsTested: candles.length,
    timeframeLabel,
    results,
    recommendedStrategy: sorted[0]?.strategy ?? 'SMART_ENSEMBLE',
    generatedAt: Date.now(),
  };
}
