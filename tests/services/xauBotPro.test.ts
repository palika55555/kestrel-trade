import {describe, expect, it} from 'vitest';
import {createDefaultXauBotConfig, evaluateXauBotSignal} from '../../src/services/xauBot';
import type {Candle, InstitutionalGoldContext, Instrument} from '../../src/types/trading';

function makeXauInstrument(price: number): Instrument {
  return {
    symbol: 'XAU/USD',
    name: 'Gold Spot',
    assetClass: 'COMMODITY_FUTURES',
    contractType: 'CFD',
    exchange: 'Swissquote',
    contractSize: 100,
    unitLabel: 'oz',
    tickSize: 0.05,
    tickValue: 5,
    decimals: 2,
    maxLeverage: 20,
    initialMarginRate: 0.05,
    maintenanceMarginRate: 0.025,
    overnightSwapLong: 0,
    overnightSwapShort: 0,
    commissionPerUnit: 0,
    price,
    bid: Number((price - 0.15).toFixed(2)),
    ask: Number((price + 0.15).toFixed(2)),
    open24h: price - 10,
    high24h: price + 25,
    low24h: price - 25,
    volume24h: 10000,
    changePct: 0.25,
    sparkline: [price],
    bids: [{price: Number((price - 0.15).toFixed(2)), size: 20, total: 20}],
    asks: [{price: Number((price + 0.15).toFixed(2)), size: 15, total: 15}],
  };
}

function makeBullTrendCandles(): Candle[] {
  const base = 1_700_000_000;
  // Zig-zag uptrend so EMA9 > EMA21, price > VWAP, and RSI stays in healthy 56-68 trend zone
  return Array.from({length: 40}, (_, i) => {
    const wave = i % 3 === 2 ? -0.9 : 1.1;
    const prevBase = 3500 + i * 0.38;
    const close = Number((prevBase + wave).toFixed(2));
    return {
      time: base + i * 300,
      open: Number((close - 0.35).toFixed(2)),
      high: Number((close + 0.7).toFixed(2)),
      low: Number((close - 0.7).toFixed(2)),
      close,
      volume: 200,
    };
  });
}

function makeBaseInstContext(overrides: Partial<InstitutionalGoldContext> = {}): InstitutionalGoldContext {
  return {
    cot: null,
    gvz: 18,
    gvzChangePct: 0,
    vix: 15,
    vixChangePct: 0,
    gldPrice: 310,
    gldChangePct: 0.4,
    gldVolume: 1_000_000,
    paxgPrice: 3535,
    paxgBuyVolumeOz: 12,
    paxgSellVolumeOz: 6,
    paxgNetDeltaOz: 6,
    paxgBuyPct: 64,
    paxgBookBidPct: 58,
    paxgLargePrints: [],
    l2Top5BidPct: 62,
    l2FullBidPct: 56,
    l2MicroTiltDollars: 0.12,
    l2NearestBidWall: null,
    l2NearestAskWall: null,
    l2WallVelocity: 'BALANCED',
    futuresOiOz: 23000,
    futuresOiDeltaPct: 0.5,
    futuresFundingRate: 0.0001,
    futuresTakerBuySellRatio: 1.25,
    futuresRegime: 'NEW_LONGS',
    tipPrice: 106,
    tipChangePct: 0.2,
    gdxPrice: 68.5,
    gdxChangePct: 0.8,
    silverPrice: 40.7,
    silverChangePct: 0.7,
    usdJpyPrice: 158.4,
    usdJpyChangePct: -0.2,
    smtDivergence: 'BULLISH_SMT',
    compositeBias: 'BULLISH',
    compositeScore: 6,
    volatilityAlert: false,
    summary: 'Pro aligned',
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('evaluateXauBotSignal pro-desk institutional gates', () => {
  it('boosts confidence when Silver SMT, Futures NEW_LONGS, TIP/GDX, and PULLING_ASKS align', () => {
    const candles = makeBullTrendCandles();
    const lastPrice = candles[candles.length - 1].close;
    const inst = makeXauInstrument(lastPrice);
    const cfg = {
      ...createDefaultXauBotConfig(),
      strategy: 'EMA_MOMENTUM' as const,
      useSessionSpreadGuard: false,
      useNewsGuard: false,
      minConfidence: 55,
    };

    const bullRes = evaluateXauBotSignal(inst, candles, cfg, 15, [], [], {
      institutional: makeBaseInstContext({
        l2WallVelocity: 'PULLING_ASKS',
        l2NearestAskWall: {side: 'ASK', price: lastPrice + 0.5, size: 18, distanceDollars: 0.5, venueLabel: 'Binance'},
      }),
      nowMs: Date.UTC(2026, 2, 10, 14, 0),
    });

    const headwindRes = evaluateXauBotSignal(inst, candles, cfg, 15, [], [], {
      institutional: makeBaseInstContext({
        l2WallVelocity: 'STACKING_ASKS',
        l2NearestAskWall: {side: 'ASK', price: lastPrice + 0.5, size: 22, distanceDollars: 0.5, venueLabel: 'Binance'},
        futuresRegime: 'SHORT_COVERING',
        futuresFundingRate: 0.0007,
        smtDivergence: 'BEARISH_SMT',
        tipChangePct: -0.25,
        gdxChangePct: -0.9,
        compositeBias: 'BEARISH',
      }),
      nowMs: Date.UTC(2026, 2, 10, 14, 0),
    });

    expect(bullRes).not.toBeNull();
    expect(headwindRes).not.toBeNull();
    expect(bullRes!.action).toBe('BUY');
    expect(bullRes!.reason).toContain('Ask Spoof Pulled');
    expect(bullRes!.reason).toContain('Silver SMT +');
    expect(bullRes!.reason).toContain('Perp OI New Longs');
    expect(bullRes!.confidence).toBeGreaterThan(headwindRes!.confidence);
    expect(headwindRes!.reason).toContain('Stacking Asks');
    expect(headwindRes!.reason).toContain('Short-Cover Risk');
  });

  it('penalizes chasing trades stretched >= 2.1 ATR above VWAP', () => {
    const base = 1_700_000_000;
    // Slight pullback sequence before a sudden breakout spike far above VWAP (ORB_VWAP triggers BUY, overextension guard penalizes)
    const candles: Candle[] = Array.from({length: 39}, (_, i) => {
      const c = i % 2 === 0 ? 3499.5 : 3500.5;
      return {
        time: base + i * 300,
        open: c - 0.3,
        high: c + 0.6,
        low: c - 0.6,
        close: c,
        volume: 400,
      };
    });
    candles.push({
      time: base + 39 * 300,
      open: 3501,
      high: 3518,
      low: 3501,
      close: 3517,
      volume: 100,
    });

    const inst = makeXauInstrument(3517);
    const cfg = {
      ...createDefaultXauBotConfig(),
      strategy: 'ORB_VWAP' as const,
      useSessionSpreadGuard: false,
      useNewsGuard: false,
      useOrderFlowConfluence: false,
      useMacroConfluence: false,
    };

    const res = evaluateXauBotSignal(inst, candles, cfg, 15, [], [], {
      nowMs: Date.UTC(2026, 2, 10, 14, 0),
    });

    expect(res).not.toBeNull();
    expect(res!.reason).toContain('Extended above VWAP');
  });
});
