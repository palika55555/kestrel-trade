import type {
  Candle,
  EODReport,
  Instrument,
  OrderSide,
  PendingOrder,
  Position,
  PriceAlert,
  RiskSettings,
  SecurityState,
  TradeExecution,
} from '../types/trading';

export function formatPrice(price: number, decimals: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCurrency(value: number, compact = false): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (compact && abs >= 1000000) {
    return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  }
  if (compact && abs >= 10000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function computePositionNotional(
  price: number,
  quantity: number,
  instrument: Instrument,
): number {
  return price * quantity * instrument.contractSize;
}

export function computeRequiredMargin(
  price: number,
  quantity: number,
  leverage: number,
  instrument: Instrument,
): number {
  const notional = computePositionNotional(price, quantity, instrument);
  return notional / Math.max(1, leverage);
}

export function computeUnrealizedPnl(
  position: Position,
  instrument: Instrument,
): number {
  // Use bid for closing LONG, ask for closing SHORT
  const markPrice = position.side === 'BUY' ? instrument.bid : instrument.ask;
  const priceDiff =
    position.side === 'BUY'
      ? markPrice - position.entryPrice
      : position.entryPrice - markPrice;

  if (instrument.symbol === 'GBP/JPY') {
    // Convert JPY P&L to USD using ~152.5 rate (tickValue = $6.55 per 0.01 per 100k lot)
    return (priceDiff / instrument.tickSize) * instrument.tickValue * position.quantity;
  }

  return priceDiff * position.quantity * instrument.contractSize;
}

export function computeLiquidationPrice(
  entryPrice: number,
  side: OrderSide,
  leverage: number,
  instrument: Instrument,
): number {
  const maintRate = instrument.maintenanceMarginRate;
  const moveFraction = Math.max(0.002, 1 / leverage - maintRate * 0.5);
  const raw =
    side === 'BUY'
      ? entryPrice * (1 - moveFraction)
      : entryPrice * (1 + moveFraction);
  const factor = Math.pow(10, instrument.decimals);
  return Math.max(instrument.tickSize, Math.round(raw * factor) / factor);
}

export function computePositionSizeFromRisk(
  equity: number,
  riskPct: number,
  entryPrice: number,
  stopLossPrice: number,
  instrument: Instrument,
): number {
  const riskDollars = equity * (riskPct / 100);
  const priceDist = Math.abs(entryPrice - stopLossPrice);
  if (priceDist <= instrument.tickSize * 0.5) return 0;

  let riskPerUnit: number;
  if (instrument.symbol === 'GBP/JPY') {
    riskPerUnit = (priceDist / instrument.tickSize) * instrument.tickValue;
  } else {
    riskPerUnit = priceDist * instrument.contractSize;
  }

  if (riskPerUnit <= 0) return 0;
  const rawQty = riskDollars / riskPerUnit;
  if (instrument.contractType === 'FUTURE') {
    return Math.max(1, Math.floor(rawQty));
  }
  return Math.max(0.01, Math.round(rawQty * 100) / 100);
}

// Technical Indicators
export function calculateEMA(candles: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  result[period - 1] = ema;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function calculateBollinger(
  candles: Candle[],
  period = 20,
  mult = 2,
): {upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[]} {
  const upper: (number | null)[] = new Array(candles.length).fill(null);
  const mid: (number | null)[] = new Array(candles.length).fill(null);
  const lower: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += Math.pow(candles[j].close - mean, 2);
    const std = Math.sqrt(sq / period);
    mid[i] = mean;
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return {upper, mid, lower};
}

export function calculateVWAP(candles: Candle[]): (number | null)[] {
  const res: (number | null)[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typical * candles[i].volume;
    cumV += candles[i].volume;
    res[i] = cumV > 0 ? cumPV / cumV : candles[i].close;
  }
  return res;
}

export function calculateRSI(candles: Candle[], period = 14): (number | null)[] {
  const res: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return res;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  res[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    res[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return res;
}

// Initial Seed Portfolio & EOD History
export function createDefaultRiskSettings(): RiskSettings {
  return {
    maxDailyDrawdownPct: 3.5,
    maxAssetExposurePct: 35,
    marginCallLevelPct: 120,
    stopOutLevelPct: 50,
    defaultRiskPct: 1.0,
    requireBiometricForOrders: false,
    enablePushNotifications: true,
    enableAudioChime: true,
  };
}

export function createDefaultSecurityState(): SecurityState {
  return {
    biometricEnrolled: false,
    credentialId: null,
    pinConfigured: false,
    pinHash: null,
    isLocked: false,
    lastUnlockedAt: Date.now(),
    authMethod: null,
  };
}

export function createCleanAccountState(startingBalance = 10000) {
  const cleanBalance = Math.max(100, Number(startingBalance.toFixed(2)));
  return {
    cashBalance: cleanBalance,
    dayStartEquity: cleanBalance,
    positions: [] as Position[],
    pendingOrders: [] as PendingOrder[],
    executions: [] as TradeExecution[],
    priceAlerts: [] as PriceAlert[],
    eodReports: [] as EODReport[],
  };
}

export function createInitialSeedState(_liveInstruments?: Instrument[]) {
  return createCleanAccountState(10000);
}
