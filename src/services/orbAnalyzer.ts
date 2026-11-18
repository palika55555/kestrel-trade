import {
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  formatPrice,
} from './tradingMath';
import type {
  Candle,
  Instrument,
  NotificationAutomationConfig,
  ORBAnalysis,
  ORBSignalState,
  ORBWindowMinutes,
} from '../types/trading';

export function createDefaultAutomationConfig(): NotificationAutomationConfig {
  return {
    enabled: true,
    orbWindowMinutes: 15,
    notifyOnLongBreakout: true,
    notifyOnShortBreakout: true,
    notifyOnRetestSetup: true,
    requireVwapConfluence: true,
    requireVolumeSurge: false,
    minVolumeRatio: 1.15,
    notifyOnRsiExtremes: true,
    cooldownMinutes: 10,
    autoStageTicketOnSignal: false,
    monitoredSymbols: [],
  };
}

function roundDecimals(val: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

/**
 * Deterministic Opening Range Breakout (ORB) quantitative analyzer.
 * Computes the Opening Range window from session candles, evaluates VWAP / EMA20 / RSI / Volume
 * confluence, and outputs actionable Long & Short entry, stop-loss, and R-multiple targets.
 */
export function analyzeORB(
  instrument: Instrument,
  candles: Candle[],
  windowMinutes: ORBWindowMinutes = 15,
): ORBAnalysis | null {
  if (!candles || candles.length < 15) return null;

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Determine candle spacing in seconds
  const barSec = Math.max(60, latest.time - prev.time);
  const windowBars = Math.max(2, Math.min(8, Math.round((windowMinutes * 60) / barSec)));

  // Define session opening range anchor: look back 24..48 bars as intraday session open window
  const lookbackStart = Math.max(0, candles.length - Math.max(24, windowBars + 18));
  const orSlice = candles.slice(lookbackStart, lookbackStart + windowBars);
  if (orSlice.length === 0) return null;

  let orHigh = -Infinity;
  let orLow = Infinity;
  for (const c of orSlice) {
    if (c.high > orHigh) orHigh = c.high;
    if (c.low < orLow) orLow = c.low;
  }

  orHigh = roundDecimals(orHigh, instrument.decimals);
  orLow = roundDecimals(orLow, instrument.decimals);
  const orMid = roundDecimals((orHigh + orLow) / 2, instrument.decimals);
  const rangeWidth = Math.max(instrument.tickSize * 4, orHigh - orLow);
  const rangeWidthPct = (rangeWidth / Math.max(instrument.tickSize, orMid)) * 100;

  // Indicators for directional confluence
  const ema20Arr = calculateEMA(candles, 20);
  const vwapArr = calculateVWAP(candles);
  const rsiArr = calculateRSI(candles, 14);

  const ema20 = ema20Arr[candles.length - 1] ?? latest.close;
  const vwap = vwapArr[candles.length - 1] ?? latest.close;
  const rsi14 = rsiArr[candles.length - 1] ?? 50;

  // Volume ratio vs 20-bar average
  const volSlice = candles.slice(-21, -1);
  const avgVol =
    volSlice.length > 0
      ? volSlice.reduce((a, b) => a + b.volume, 0) / volSlice.length
      : latest.volume;
  const volumeRatio = avgVol > 0 ? latest.volume / avgVol : 1;

  const price = instrument.price;
  const retestBand = rangeWidth * 0.22;

  // Check if recent candles broke above/below OR to distinguish Breakout vs Retest
  const recentPostOR = candles.slice(lookbackStart + windowBars);
  const hadBullBreak = recentPostOR.some((c) => c.close > orHigh);
  const hadBearBreak = recentPostOR.some((c) => c.close < orLow);

  let signal: ORBSignalState = 'INSIDE_RANGE';
  let bias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

  if (price > orHigh) {
    if (hadBullBreak && price - orHigh <= retestBand && latest.close >= latest.open) {
      signal = 'LONG_RETEST';
    } else {
      signal = 'LONG_BREAKOUT';
    }
    bias = 'LONG';
  } else if (price < orLow) {
    if (hadBearBreak && orLow - price <= retestBand && latest.close <= latest.open) {
      signal = 'SHORT_RETEST';
    } else {
      signal = 'SHORT_BREAKOUT';
    }
    bias = 'SHORT';
  } else {
    // Inside range: check retest right inside boundary or bias toward midpoint/VWAP
    if (hadBullBreak && orHigh - price <= retestBand * 0.6 && price >= orMid) {
      signal = 'LONG_RETEST';
      bias = 'LONG';
    } else if (hadBearBreak && price - orLow <= retestBand * 0.6 && price <= orMid) {
      signal = 'SHORT_RETEST';
      bias = 'SHORT';
    } else {
      signal = 'INSIDE_RANGE';
      bias = price > vwap && price > orMid ? 'LONG' : price < vwap && price < orMid ? 'SHORT' : 'NEUTRAL';
    }
  }

  // Deterministic Confluence Scoring
  const checks = [
    {
      label: 'ORB Boundary',
      passed: price > orHigh || price < orLow,
      detail:
        price > orHigh
          ? `Above OR High (${formatPrice(orHigh, instrument.decimals)})`
          : price < orLow
          ? `Below OR Low (${formatPrice(orLow, instrument.decimals)})`
          : `Inside range (${formatPrice(orLow, instrument.decimals)}–${formatPrice(orHigh, instrument.decimals)})`,
    },
    {
      label: 'VWAP Alignment',
      passed:
        (bias === 'LONG' && price >= vwap) ||
        (bias === 'SHORT' && price <= vwap),
      detail: `${price >= vwap ? 'Above' : 'Below'} VWAP (${formatPrice(vwap, instrument.decimals)})`,
    },
    {
      label: 'EMA 20 Trend',
      passed:
        (bias === 'LONG' && price >= ema20) ||
        (bias === 'SHORT' && price <= ema20),
      detail: `${price >= ema20 ? 'Above' : 'Below'} EMA20 (${formatPrice(ema20, instrument.decimals)})`,
    },
    {
      label: 'RSI Momentum',
      passed:
        (bias === 'LONG' && rsi14 >= 50 && rsi14 <= 74) ||
        (bias === 'SHORT' && rsi14 <= 50 && rsi14 >= 26),
      detail: `RSI(14) at ${rsi14.toFixed(1)}`,
    },
    {
      label: 'Volume Surge',
      passed: volumeRatio >= 1.15,
      detail: `${volumeRatio.toFixed(2)}x 20-bar avg`,
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const confidenceScore = Math.min(98, 25 + passedCount * 15);

  // Actionable LONG and SHORT trade plans
  const buffer = Math.max(instrument.tickSize, rangeWidth * 0.08);
  const longEntry = roundDecimals(
    signal === 'LONG_BREAKOUT' || signal === 'LONG_RETEST' ? instrument.ask : orHigh + buffer,
    instrument.decimals,
  );
  const longStop = roundDecimals(Math.max(orMid - buffer, orLow), instrument.decimals);
  const longRisk = Math.max(instrument.tickSize * 2, longEntry - longStop);
  const longTp1 = roundDecimals(longEntry + longRisk * 1.5, instrument.decimals);
  const longTp2 = roundDecimals(longEntry + longRisk * 2.5, instrument.decimals);

  const shortEntry = roundDecimals(
    signal === 'SHORT_BREAKOUT' || signal === 'SHORT_RETEST' ? instrument.bid : orLow - buffer,
    instrument.decimals,
  );
  const shortStop = roundDecimals(Math.min(orMid + buffer, orHigh), instrument.decimals);
  const shortRisk = Math.max(instrument.tickSize * 2, shortStop - shortEntry);
  const shortTp1 = roundDecimals(shortEntry - shortRisk * 1.5, instrument.decimals);
  const shortTp2 = roundDecimals(shortEntry - shortRisk * 2.5, instrument.decimals);

  let rationale = '';
  if (signal === 'LONG_BREAKOUT') {
    rationale = `Bullish breakout above ${windowMinutes}m Opening Range High (${formatPrice(
      orHigh,
      instrument.decimals,
    )}). Favor Long continuation while price holds above OR High and VWAP.`;
  } else if (signal === 'LONG_RETEST') {
    rationale = `Pullback retest of ${windowMinutes}m OR High support. High-R:R Long entry zone with invalidation below OR Mid (${formatPrice(
      orMid,
      instrument.decimals,
    )}).`;
  } else if (signal === 'SHORT_BREAKOUT') {
    rationale = `Bearish breakdown below ${windowMinutes}m Opening Range Low (${formatPrice(
      orLow,
      instrument.decimals,
    )}). Favor Short momentum targeting 1.5R–2.5R extension.`;
  } else if (signal === 'SHORT_RETEST') {
    rationale = `Rejection retest at broken ${windowMinutes}m OR Low resistance. Favor Short continuation with stop above OR Mid (${formatPrice(
      orMid,
      instrument.decimals,
    )}).`;
  } else {
    rationale = `Price consolidating inside ${windowMinutes}m Opening Range (${formatPrice(
      orLow,
      instrument.decimals,
    )} – ${formatPrice(orHigh, instrument.decimals)}). Wait for confirmed breakout above OR High to Long or breakdown below OR Low to Short.`;
  }

  return {
    symbol: instrument.symbol,
    windowMinutes,
    orHigh,
    orLow,
    orMid,
    rangeWidth: roundDecimals(rangeWidth, instrument.decimals),
    rangeWidthPct: Number(rangeWidthPct.toFixed(3)),
    rangeStartTime: orSlice[0].time,
    rangeEndTime: orSlice[orSlice.length - 1].time,
    currentPrice: price,
    vwap: roundDecimals(vwap, instrument.decimals),
    ema20: roundDecimals(ema20, instrument.decimals),
    rsi14: Number(rsi14.toFixed(1)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    signal,
    bias,
    confidenceScore,
    confluenceChecks: checks,
    longPlan: {
      side: 'BUY',
      entryPrice: longEntry,
      stopLoss: longStop,
      takeProfit1R: longTp1,
      takeProfit2R: longTp2,
      conditionSummary: `Go LONG on candle close / break above ${formatPrice(
        orHigh,
        instrument.decimals,
      )} with VWAP (${formatPrice(vwap, instrument.decimals)}) support.`,
    },
    shortPlan: {
      side: 'SELL',
      entryPrice: shortEntry,
      stopLoss: shortStop,
      takeProfit1R: shortTp1,
      takeProfit2R: shortTp2,
      conditionSummary: `Go SHORT on candle close / break below ${formatPrice(
        orLow,
        instrument.decimals,
      )} below VWAP (${formatPrice(vwap, instrument.decimals)}).`,
    },
    rationale,
  };
}
