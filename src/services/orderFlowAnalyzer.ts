import {
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  formatPrice,
} from './tradingMath';
import type {
  BarDeltaPoint,
  Candle,
  FootprintClusterRow,
  InstitutionalGoldContext,
  Instrument,
  LiquidityZone,
  MarketPrint,
  OrderFlowSnapshot,
  PendingOrder,
  VolumeProfileRow,
} from '../types/trading';

function roundDecimals(val: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function analyzeOrderFlow(
  instrument: Instrument,
  candles: Candle[],
  recentPrints: MarketPrint[],
  userPendingOrders: PendingOrder[],
  institutional?: InstitutionalGoldContext | null,
): OrderFlowSnapshot | null {
  if (!candles || candles.length < 20) return null;

  const recentBars = candles.slice(-60);
  const lastIdx = recentBars.length - 1;
  const dec = instrument.decimals;
  const isGoldSymbol = instrument.symbol === 'XAU/USD' || instrument.symbol === 'GC1!';

  // 1. Buy vs Sell Volume Pressure, Bar-by-Bar Delta & CVD across last 24 bars
  const deltaBars = recentBars.slice(-24);
  let buyVolSum = 0;
  let sellVolSum = 0;
  let cvd = 0;
  const barDeltas: BarDeltaPoint[] = [];

  for (let i = 0; i < deltaBars.length; i++) {
    const bar = deltaBars[i];
    const range = Math.max(instrument.tickSize, bar.high - bar.low);
    const buyShare = Math.max(0.1, Math.min(0.9, (bar.close - bar.low) / range));
    const vol = Math.max(1, bar.volume || 1);
    let bVol = vol * buyShare;
    let sVol = vol * (1 - buyShare);

    // On the active bar, blend live executed PAXG/Kraken aggressor share when available
    if (i === deltaBars.length - 1 && isGoldSymbol && institutional && institutional.paxgBuyVolumeOz + institutional.paxgSellVolumeOz > 0) {
      const paxgShare = institutional.paxgBuyPct / 100;
      const blendedShare = buyShare * 0.55 + paxgShare * 0.45;
      bVol = vol * blendedShare;
      sVol = vol * (1 - blendedShare);
    }

    const barDelta = bVol - sVol;
    buyVolSum += bVol;
    sellVolSum += sVol;
    cvd += barDelta;
    if (i >= deltaBars.length - 12) {
      barDeltas.push({
        time: bar.time,
        delta: Math.round(barDelta),
        cvd: Math.round(cvd),
        buyVolume: Math.round(bVol),
        sellVolume: Math.round(sVol),
        totalVolume: Math.round(vol),
      });
    }
  }

  const totalBarVol = Math.max(1, buyVolSum + sellVolSum);
  let buyPressurePct = (buyVolSum / totalBarVol) * 100;

  // Blend in live tick / trade tape delta + PAXG real executed Gold flow
  const tickBuyCount = recentPrints.filter((p) => p.side === 'BUY').length;
  const tickSellCount = recentPrints.filter((p) => p.side === 'SELL').length;
  const totalPrints = tickBuyCount + tickSellCount;
  if (totalPrints >= 4) {
    const tapeBuyPct = (tickBuyCount / totalPrints) * 100;
    buyPressurePct = buyPressurePct * 0.7 + tapeBuyPct * 0.3;
  }
  if (isGoldSymbol && institutional && institutional.paxgBuyVolumeOz + institutional.paxgSellVolumeOz > 0) {
    buyPressurePct = buyPressurePct * 0.75 + institutional.paxgBuyPct * 0.25;
  }
  buyPressurePct = Math.round(Math.max(5, Math.min(95, buyPressurePct)));
  const sellPressurePct = 100 - buyPressurePct;

  // 2. Order Book Bid/Ask Imbalance
  const totalBidDepth = Number(
    instrument.bids.reduce((a, b) => a + b.size, 0).toFixed(2),
  );
  const totalAskDepth = Number(
    instrument.asks.reduce((a, b) => a + b.size, 0).toFixed(2),
  );
  const totalDepth = Math.max(0.01, totalBidDepth + totalAskDepth);
  const bookImbalancePct = Math.round((totalBidDepth / totalDepth) * 100);

  // 3. 18-Row Volume Profile (POC, VAH, VAL) over recent 60 candles
  const lowRange = Math.min(...recentBars.map((b) => b.low));
  const highRange = Math.max(...recentBars.map((b) => b.high));
  const span = Math.max(instrument.tickSize * 18, highRange - lowRange);
  const bins = 18;
  const binSize = span / bins;

  const rawBins: VolumeProfileRow[] = Array.from({length: bins}, (_, i) => {
    const pLow = lowRange + i * binSize;
    const pHigh = pLow + binSize;
    return {
      priceLow: roundDecimals(pLow, dec),
      priceHigh: roundDecimals(pHigh, dec),
      priceMid: roundDecimals((pLow + pHigh) / 2, dec),
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      isPoc: false,
      inValueArea: false,
    };
  });

  for (const bar of recentBars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    const idx = Math.min(
      bins - 1,
      Math.max(0, Math.floor((typical - lowRange) / binSize)),
    );
    const range = Math.max(instrument.tickSize, bar.high - bar.low);
    const buyShare = Math.max(0.1, Math.min(0.9, (bar.close - bar.low) / range));
    const vol = Math.max(1, bar.volume || 1);
    rawBins[idx].buyVolume += vol * buyShare;
    rawBins[idx].sellVolume += vol * (1 - buyShare);
    rawBins[idx].totalVolume += vol;
  }

  let pocIdx = 0;
  for (let i = 1; i < rawBins.length; i++) {
    if (rawBins[i].totalVolume > rawBins[pocIdx].totalVolume) pocIdx = i;
  }
  rawBins[pocIdx].isPoc = true;
  rawBins[pocIdx].inValueArea = true;

  // Expand 70% Value Area outward from POC
  const totalProfileVol = rawBins.reduce((a, b) => a + b.totalVolume, 0);
  let vaVol = rawBins[pocIdx].totalVolume;
  let loPtr = pocIdx - 1;
  let hiPtr = pocIdx + 1;
  while (vaVol < totalProfileVol * 0.7 && (loPtr >= 0 || hiPtr < bins)) {
    const loVol = loPtr >= 0 ? rawBins[loPtr].totalVolume : -1;
    const hiVol = hiPtr < bins ? rawBins[hiPtr].totalVolume : -1;
    if (hiVol >= loVol && hiPtr < bins) {
      rawBins[hiPtr].inValueArea = true;
      vaVol += hiVol;
      hiPtr++;
    } else if (loPtr >= 0) {
      rawBins[loPtr].inValueArea = true;
      vaVol += loVol;
      loPtr--;
    } else {
      break;
    }
  }

  const vaRows = rawBins.filter((r) => r.inValueArea);
  const pocPrice = rawBins[pocIdx].priceMid;
  const valPrice = vaRows.length > 0 ? vaRows[0].priceLow : lowRange;
  const vahPrice =
    vaRows.length > 0 ? vaRows[vaRows.length - 1].priceHigh : highRange;

  // 4. ATR(14) & Volatility Regime
  const atr14 = roundDecimals(calculateATR(recentBars, 14), dec);
  const atrPct = instrument.price > 0 ? (atr14 / instrument.price) * 100 : 0;
  const avgCandleRange =
    recentBars.reduce((a, b) => a + (b.high - b.low), 0) / recentBars.length;
  const volatilityRegime: OrderFlowSnapshot['volatilityRegime'] =
    atr14 > avgCandleRange * 1.25
      ? 'HIGH'
      : atr14 < avgCandleRange * 0.8
      ? 'LOW'
      : 'NORMAL';

  // 5. Liquidity Pools & Resting Pending Order Zones
  const liquidityZones: LiquidityZone[] = [];

  // Key Volume Profile levels
  liquidityZones.push({
    id: 'lz-poc',
    label: 'POC (Highest Volume)',
    type: 'POC',
    price: pocPrice,
    strength: 92,
    sideBias: instrument.price >= pocPrice ? 'BUY' : 'SELL',
    description: 'High-volume institutional magnet & equilibrium pivot.',
  });
  liquidityZones.push({
    id: 'lz-vah',
    label: 'Value Area High (VAH)',
    type: 'VAH',
    price: roundDecimals(vahPrice, dec),
    strength: 78,
    sideBias: 'SELL',
    description: 'Upper 70% value boundary where resting asks & profit-taking sit.',
  });
  liquidityZones.push({
    id: 'lz-val',
    label: 'Value Area Low (VAL)',
    type: 'VAL',
    price: roundDecimals(valPrice, dec),
    strength: 78,
    sideBias: 'BUY',
    description: 'Lower 70% value boundary where resting institutional bids sit.',
  });

  // Swing Highs (BSL) & Swing Lows (SSL)
  let nearestBsl: number | null = null;
  let nearestSsl: number | null = null;
  for (let i = recentBars.length - 4; i >= 3; i--) {
    const b = recentBars[i];
    const isSwingHigh =
      b.high > recentBars[i - 1].high &&
      b.high > recentBars[i - 2].high &&
      b.high > recentBars[i + 1].high &&
      b.high > recentBars[i + 2].high;
    if (isSwingHigh && b.high > instrument.price && nearestBsl === null) {
      nearestBsl = roundDecimals(b.high, dec);
      liquidityZones.push({
        id: `lz-bsl-${i}`,
        label: 'Buy-Side Liquidity (BSL)',
        type: 'BSL',
        price: nearestBsl,
        strength: 86,
        sideBias: 'BUY',
        description:
          'Stop-buy orders & short stop-losses clustered above recent swing high.',
      });
    }

    const isSwingLow =
      b.low < recentBars[i - 1].low &&
      b.low < recentBars[i - 2].low &&
      b.low < recentBars[i + 1].low &&
      b.low < recentBars[i + 2].low;
    if (isSwingLow && b.low < instrument.price && nearestSsl === null) {
      nearestSsl = roundDecimals(b.low, dec);
      liquidityZones.push({
        id: `lz-ssl-${i}`,
        label: 'Sell-Side Liquidity (SSL)',
        type: 'SSL',
        price: nearestSsl,
        strength: 86,
        sideBias: 'SELL',
        description:
          'Long stop-losses & resting buy-limit orders clustered below swing low.',
      });
    }
    if (nearestBsl !== null && nearestSsl !== null) break;
  }

  // Latest Fair Value Gap (FVG)
  for (let i = recentBars.length - 2; i >= 2; i--) {
    const c1 = recentBars[i - 2];
    const c3 = recentBars[i];
    if (c3.low > c1.high + instrument.tickSize * 2 && c3.low < instrument.price) {
      liquidityZones.push({
        id: `lz-fvgb-${i}`,
        label: 'Bullish FVG Imbalance',
        type: 'FVG_BULL',
        price: roundDecimals((c1.high + c3.low) / 2, dec),
        secondaryPrice: roundDecimals(c1.high, dec),
        strength: 74,
        sideBias: 'BUY',
        description: `Unfilled buy imbalance (${formatPrice(c1.high, dec)}–${formatPrice(
          c3.low,
          dec,
        )}) often revisited by Buy Limit orders.`,
      });
      break;
    }
    if (c3.high < c1.low - instrument.tickSize * 2 && c3.high > instrument.price) {
      liquidityZones.push({
        id: `lz-fvgs-${i}`,
        label: 'Bearish FVG Imbalance',
        type: 'FVG_BEAR',
        price: roundDecimals((c1.low + c3.high) / 2, dec),
        secondaryPrice: roundDecimals(c1.low, dec),
        strength: 74,
        sideBias: 'SELL',
        description: `Unfilled sell imbalance (${formatPrice(c3.high, dec)}–${formatPrice(
          c1.low,
          dec,
        )}) often revisited by Sell Limit orders.`,
      });
      break;
    }
  }

  // Merge user's own active Pending Limit / Stop orders for this symbol
  userPendingOrders
    .filter((o) => o.symbol === instrument.symbol)
    .forEach((o) => {
      liquidityZones.push({
        id: `lz-up-${o.id}`,
        label: `Your Pending ${o.side} ${o.type}`,
        type: 'USER_PENDING',
        price: o.triggerPrice,
        strength: 95,
        sideBias: o.side,
        description: `${o.quantity} ${instrument.unitLabel} resting at ${formatPrice(
          o.triggerPrice,
          dec,
        )}`,
      });
    });

  liquidityZones.sort((a, b) => b.price - a.price);

  // 5b. ATAS-Style Footprint Price Clusters (Bid x Ask per cluster over recent 4 bars + live tape)
  const clusterBars = recentBars.slice(-4);
  const cLow = Math.min(...clusterBars.map((b) => b.low));
  const cHigh = Math.max(...clusterBars.map((b) => b.high));
  const cSpan = Math.max(instrument.tickSize * 10, cHigh - cLow);
  const clusterCount = 10;
  const cStep = cSpan / clusterCount;

  const rawClusters: FootprintClusterRow[] = Array.from({length: clusterCount}, (_, i) => {
    const pLow = cLow + i * cStep;
    const pHigh = pLow + cStep;
    return {
      priceLow: roundDecimals(pLow, dec),
      priceHigh: roundDecimals(pHigh, dec),
      priceMid: roundDecimals((pLow + pHigh) / 2, dec),
      bidVolume: 0,
      askVolume: 0,
      delta: 0,
      totalVolume: 0,
      imbalance: 'NONE',
      isBarPoc: false,
    };
  });

  for (const bar of clusterBars) {
    const vol = Math.max(10, bar.volume || 10);
    const bodyBullish = bar.close >= bar.open;
    const loIdx = Math.max(0, Math.min(clusterCount - 1, Math.floor((bar.low - cLow) / cStep)));
    const hiIdx = Math.max(loIdx, Math.min(clusterCount - 1, Math.floor((bar.high - cLow) / cStep)));
    const levels = hiIdx - loIdx + 1;
    const perLevel = vol / levels;
    for (let li = loIdx; li <= hiIdx; li++) {
      const posFrac = levels > 1 ? (li - loIdx) / (levels - 1) : 0.5;
      // Upper ticks carry aggressive ask-lifting in bullish bars; lower ticks carry bid-hitting in bearish bars
      const askRatio = bodyBullish
        ? Math.min(0.84, Math.max(0.25, 0.48 + posFrac * 0.34))
        : Math.min(0.75, Math.max(0.16, 0.22 + posFrac * 0.32));
      rawClusters[li].askVolume += perLevel * askRatio;
      rawClusters[li].bidVolume += perLevel * (1 - askRatio);
    }
  }

  for (const print of recentPrints.slice(0, 40)) {
    const idx = Math.max(0, Math.min(clusterCount - 1, Math.floor((print.price - cLow) / cStep)));
    const weight = Math.max(2, print.size * 25);
    if (print.side === 'BUY') rawClusters[idx].askVolume += weight;
    else rawClusters[idx].bidVolume += weight;
  }

  let maxClusterVol = 0;
  let barPocIdx = 0;
  for (let i = 0; i < rawClusters.length; i++) {
    const row = rawClusters[i];
    row.bidVolume = Math.round(row.bidVolume);
    row.askVolume = Math.round(row.askVolume);
    row.delta = row.askVolume - row.bidVolume;
    row.totalVolume = row.askVolume + row.bidVolume;
    if (row.askVolume >= Math.max(10, row.bidVolume * 2.4)) {
      row.imbalance = 'BUY';
    } else if (row.bidVolume >= Math.max(10, row.askVolume * 2.4)) {
      row.imbalance = 'SELL';
    }
    if (row.totalVolume > maxClusterVol) {
      maxClusterVol = row.totalVolume;
      barPocIdx = i;
    }
  }
  rawClusters[barPocIdx].isBarPoc = true;

  // Detect 2+ consecutive Bid or Ask imbalances (ATAS Stacked Imbalance)
  let stackedImbalance: OrderFlowSnapshot['stackedImbalance'] = 'NONE';
  let buyRun = 0;
  let sellRun = 0;
  for (const row of rawClusters) {
    if (row.imbalance === 'BUY') {
      buyRun += 1;
      sellRun = 0;
    } else if (row.imbalance === 'SELL') {
      sellRun += 1;
      buyRun = 0;
    } else {
      buyRun = 0;
      sellRun = 0;
    }
    if (buyRun >= 2) stackedImbalance = 'BULLISH_STACK';
    if (sellRun >= 2) stackedImbalance = 'BEARISH_STACK';
  }

  // Detect CVD Divergence & Passive Absorption (price stalls/reverses against delta)
  let cvdDivergence: OrderFlowSnapshot['cvdDivergence'] = 'NONE';
  let absorptionSignal: OrderFlowSnapshot['absorptionSignal'] = 'NONE';
  if (barDeltas.length >= 5) {
    const recentSlice = recentBars.slice(-5);
    const priceChange = recentSlice[recentSlice.length - 1].close - recentSlice[0].close;
    const cvdChange = barDeltas[barDeltas.length - 1].cvd - barDeltas[barDeltas.length - 5].cvd;
    if (priceChange <= 0 && cvdChange > 0 && buyPressurePct >= 52) {
      cvdDivergence = 'BULLISH';
      if (instrument.price <= pocPrice + atr14 * 0.25) {
        absorptionSignal = 'BULLISH_ABSORPTION';
      }
    } else if (priceChange >= 0 && cvdChange < 0 && sellPressurePct >= 52) {
      cvdDivergence = 'BEARISH';
      if (instrument.price >= pocPrice - atr14 * 0.25) {
        absorptionSignal = 'BEARISH_ABSORPTION';
      }
    }
  }

  // 6. Technical Confluence Score (EMA9/21 + VWAP + RSI + Volume Delta + Book + ATAS Imbalance/Absorption)
  const ema9Arr = calculateEMA(recentBars, 9);
  const ema21Arr = calculateEMA(recentBars, 21);
  const vwapArr = calculateVWAP(recentBars);
  const rsiArr = calculateRSI(recentBars, 14);

  const ema9 = ema9Arr[lastIdx] ?? instrument.price;
  const ema21 = ema21Arr[lastIdx] ?? instrument.price;
  const vwap = vwapArr[lastIdx] ?? instrument.price;
  const rsi14 = rsiArr[lastIdx] ?? 50;

  let score = 50;
  if (ema9 > ema21) score += 11;
  else score -= 11;

  if (instrument.price > vwap) score += 9;
  else score -= 9;

  if (buyPressurePct >= 56) score += 11;
  else if (buyPressurePct <= 44) score -= 11;

  if (bookImbalancePct >= 56) score += 7;
  else if (bookImbalancePct <= 44) score -= 7;

  if (stackedImbalance === 'BULLISH_STACK') score += 6;
  else if (stackedImbalance === 'BEARISH_STACK') score -= 6;

  if (absorptionSignal === 'BULLISH_ABSORPTION' || cvdDivergence === 'BULLISH') score += 5;
  else if (absorptionSignal === 'BEARISH_ABSORPTION' || cvdDivergence === 'BEARISH') score -= 5;

  if (rsi14 >= 52 && rsi14 <= 68) score += 7;
  else if (rsi14 <= 48 && rsi14 >= 32) score -= 7;

  score = Math.max(5, Math.min(95, Math.round(score)));
  const verdict: OrderFlowSnapshot['verdict'] =
    score >= 74
      ? 'STRONG_BUY'
      : score >= 58
      ? 'BUY'
      : score <= 26
      ? 'STRONG_SELL'
      : score <= 42
      ? 'SELL'
      : 'NEUTRAL';

  const isBullishBias = score >= 50;
  const safeAtr = Math.max(instrument.tickSize * 8, atr14);

  const pullbackEntry = roundDecimals(
    isBullishBias
      ? Math.min(instrument.bid - instrument.tickSize * 2, Math.max(valPrice, pocPrice))
      : Math.max(instrument.ask + instrument.tickSize * 2, Math.min(vahPrice, pocPrice)),
    dec,
  );
  const pullbackSetup = {
    side: (isBullishBias ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
    orderType: 'LIMIT' as const,
    entryPrice: pullbackEntry,
    stopLoss: roundDecimals(
      isBullishBias ? pullbackEntry - safeAtr * 1.4 : pullbackEntry + safeAtr * 1.4,
      dec,
    ),
    takeProfit: roundDecimals(
      isBullishBias ? pullbackEntry + safeAtr * 2.8 : pullbackEntry - safeAtr * 2.8,
      dec,
    ),
    rationale: isBullishBias
      ? `Pullback Buy Limit near institutional Value/POC support (${formatPrice(
          pullbackEntry,
          dec,
        )}) with 1:2 ATR bracket.`
      : `Pullback Sell Limit near Value/POC supply (${formatPrice(
          pullbackEntry,
          dec,
        )}) with 1:2 ATR bracket.`,
  };

  const bslTrigger =
    nearestBsl ?? roundDecimals(instrument.ask + safeAtr * 0.6, dec);
  const sslTrigger =
    nearestSsl ?? roundDecimals(instrument.bid - safeAtr * 0.6, dec);

  const breakoutEntry = isBullishBias ? bslTrigger : sslTrigger;
  const breakoutSetup = {
    side: (isBullishBias ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
    orderType: 'STOP' as const,
    entryPrice: breakoutEntry,
    stopLoss: roundDecimals(
      isBullishBias ? breakoutEntry - safeAtr * 1.3 : breakoutEntry + safeAtr * 1.3,
      dec,
    ),
    takeProfit: roundDecimals(
      isBullishBias ? breakoutEntry + safeAtr * 2.6 : breakoutEntry - safeAtr * 2.6,
      dec,
    ),
    rationale: isBullishBias
      ? `Buy Stop above Buy-Side Liquidity (${formatPrice(
          breakoutEntry,
          dec,
        )}) to catch stop-run breakout momentum.`
      : `Sell Stop below Sell-Side Liquidity (${formatPrice(
          breakoutEntry,
          dec,
        )}) to catch breakdown sweep.`,
  };

  return {
    symbol: instrument.symbol,
    timestamp: Date.now(),
    buyPressurePct,
    sellPressurePct,
    cvd: Math.round(cvd),
    bookImbalancePct,
    totalBidDepth,
    totalAskDepth,
    tickBuyCount,
    tickSellCount,
    atr14,
    atrPct: Number(atrPct.toFixed(2)),
    volatilityRegime,
    pocPrice,
    vahPrice: roundDecimals(vahPrice, dec),
    valPrice: roundDecimals(valPrice, dec),
    volumeProfile: [...rawBins].reverse(), // highest price at top
    footprintClusters: [...rawClusters].reverse(),
    barDeltas,
    stackedImbalance,
    absorptionSignal,
    cvdDivergence,
    liquidityZones,
    verdict,
    verdictScore: score,
    pullbackSetup,
    breakoutSetup,
  };
}
