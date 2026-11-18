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

export function createInitialSeedState(liveInstruments?: Instrument[]) {
  const now = Date.now();
  const findPrice = (sym: string, fallback: number) =>
    liveInstruments?.find((i) => i.symbol === sym)?.price || fallback;

  const esPrice = findPrice('ES1!', 7418.0);
  const esEntry = Number((esPrice - 6.5).toFixed(2));
  const eurPrice = findPrice('EUR/USD', 1.1);
  const eurEntry = Number((eurPrice + 0.0014).toFixed(5));
  const xauPrice = findPrice('XAU/USD', 3868.3);
  const btcPrice = findPrice('BTC/USD', 64266.0);

  const positions: Position[] = [
    {
      id: 'pos-es-01',
      symbol: 'ES1!',
      side: 'BUY',
      quantity: 2,
      entryPrice: esEntry,
      leverage: 15,
      marginUsed: (esEntry * 2 * 50) / 15,
      stopLoss: Number((esEntry - 24).toFixed(2)),
      takeProfit: Number((esEntry + 48).toFixed(2)),
      trailingStopDistance: null,
      peakFavorablePrice: esPrice,
      openedAt: now - 1000 * 60 * 95,
      commissionPaid: 4.5,
    },
    {
      id: 'pos-eur-02',
      symbol: 'EUR/USD',
      side: 'SELL',
      quantity: 0.8,
      entryPrice: eurEntry,
      leverage: 25,
      marginUsed: (eurEntry * 0.8 * 100000) / 25,
      stopLoss: Number((eurEntry + 0.0042).toFixed(5)),
      takeProfit: Number((eurEntry - 0.0068).toFixed(5)),
      trailingStopDistance: null,
      peakFavorablePrice: eurPrice,
      openedAt: now - 1000 * 60 * 210,
      commissionPaid: 2.8,
    },
  ];

  const pendingOrders: PendingOrder[] = [
    {
      id: 'ord-xau-01',
      symbol: 'XAU/USD',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.5,
      triggerPrice: Number((xauPrice - 14.5).toFixed(2)),
      leverage: 15,
      stopLoss: Number((xauPrice - 32.0).toFixed(2)),
      takeProfit: Number((xauPrice + 28.0).toFixed(2)),
      createdAt: now - 1000 * 60 * 48,
    },
  ];

  const executions: TradeExecution[] = [
    {
      id: 'exec-101',
      symbol: 'NQ1!',
      side: 'BUY',
      action: 'TAKE_PROFIT',
      quantity: 1,
      price: findPrice('NQ1!', 25680.0),
      realizedPnl: 1240.0,
      fee: 2.25,
      timestamp: now - 1000 * 60 * 145,
      notes: 'Automated TP fill',
    },
    {
      id: 'exec-102',
      symbol: 'CL1!',
      side: 'SELL',
      action: 'STOP_LOSS',
      quantity: 1,
      price: findPrice('CL1!', 71.5),
      realizedPnl: -410.0,
      fee: 2.5,
      timestamp: now - 1000 * 60 * 280,
      notes: 'Automated SL trigger',
    },
    {
      id: 'exec-103',
      symbol: 'ES1!',
      side: 'BUY',
      action: 'OPEN',
      quantity: 2,
      price: esEntry,
      realizedPnl: 0,
      fee: 4.5,
      timestamp: now - 1000 * 60 * 95,
      notes: 'Market execution',
    },
    {
      id: 'exec-104',
      symbol: 'EUR/USD',
      side: 'SELL',
      action: 'OPEN',
      quantity: 0.8,
      price: eurEntry,
      realizedPnl: 0,
      fee: 2.8,
      timestamp: now - 1000 * 60 * 210,
      notes: 'Market execution',
    },
  ];

  const priceAlerts: PriceAlert[] = [
    {
      id: 'alrt-1',
      symbol: 'XAU/USD',
      condition: 'ABOVE',
      targetPrice: Number((xauPrice + 12.0).toFixed(2)),
      active: true,
      createdAt: now - 1000 * 60 * 80,
      note: 'Spot Gold resistance breakout',
    },
    {
      id: 'alrt-2',
      symbol: 'BTC/USD',
      condition: 'BELOW',
      targetPrice: Number((btcPrice - 650).toFixed(0)),
      active: true,
      createdAt: now - 1000 * 60 * 120,
      note: 'Key institutional support',
    },
  ];

  // 14 historical EOD reports ending yesterday
  const dailyPnls = [
    1120, -480, 1650, 740, -920, 2140, 530, 1380, -310, 1890, 620, -640, 1490, 1185,
  ];
  const eodReports: EODReport[] = [];
  let equity = 115200;
  const baseDate = new Date('2026-11-16T21:00:00Z').getTime();

  for (let i = dailyPnls.length - 1; i >= 0; i--) {
    // Build chronologically from 14 days ago
  }

  // Forward chronological build
  for (let idx = 0; idx < dailyPnls.length; idx++) {
    const daysAgo = dailyPnls.length - 1 - idx;
    const d = new Date(baseDate - daysAgo * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const netPnl = dailyPnls[idx];
    const commissions = 18.5 + (idx % 4) * 6.2;
    const swapFees = idx % 3 === 0 ? -12.4 : -6.8;
    const realizedPnl = Number((netPnl - commissions - swapFees).toFixed(2));
    const startingEquity = Number(equity.toFixed(2));
    const endingEquity = Number((startingEquity + netPnl).toFixed(2));
    const tradesCount = 5 + (idx % 6);
    const winCount = netPnl >= 0 ? Math.ceil(tradesCount * 0.65) : Math.floor(tradesCount * 0.35);
    const lossCount = tradesCount - winCount;

    eodReports.push({
      id: `eod-${dateStr}`,
      date: dateStr,
      startingEquity,
      endingEquity,
      realizedPnl,
      unrealizedPnl: Number(((idx % 2 === 0 ? 1 : -1) * (120 + idx * 14)).toFixed(2)),
      swapFees,
      commissions: -Number(commissions.toFixed(2)),
      netPnl,
      returnPct: Number(((netPnl / startingEquity) * 100).toFixed(2)),
      tradesCount,
      winCount,
      lossCount,
      winRate: Number(((winCount / tradesCount) * 100).toFixed(1)),
      profitFactor: netPnl >= 0 ? Number((1.45 + (idx % 5) * 0.22).toFixed(2)) : 0.78,
      maxDrawdownPct: Number((0.4 + (idx % 4) * 0.35).toFixed(2)),
      peakMarginUsed: Math.round(14500 + (idx % 5) * 3200),
      assetBreakdown: {
        FUTURES: Math.round(netPnl * 0.52),
        COMMODITY_FUTURES: Math.round(netPnl * 0.18),
        FX_CFD: Math.round(netPnl * 0.2),
        CRYPTO_CFD: Math.round(netPnl * 0.1),
      },
      settledAt: d.getTime(),
    });

    equity = endingEquity;
  }

  return {
    cashBalance: Number((equity + 830).toFixed(2)), // includes today's realized +1240 - 410 = +830
    dayStartEquity: equity,
    positions,
    pendingOrders,
    executions,
    priceAlerts,
    eodReports: eodReports.reverse(), // newest first
  };
}
