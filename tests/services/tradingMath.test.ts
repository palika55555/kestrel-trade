import {describe, expect, it} from 'vitest';
import {
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  computeLiquidationPrice,
  computePositionSizeFromRisk,
  computeRequiredMargin,
  computeUnrealizedPnl,
  createCleanAccountState,
  createDefaultRiskSettings,
  formatCurrency,
  formatPrice,
} from '../../src/services/tradingMath.ts';
import type {Instrument, Position} from '../../src/types/trading.ts';
import {candlesFromCloses} from '../helpers.ts';

const XAU = {
  symbol: 'XAU/USD',
  contractType: 'CFD',
  contractSize: 100,
  tickSize: 0.01,
  tickValue: 1,
  decimals: 2,
  maintenanceMarginRate: 0.01,
  bid: 2399.5,
  ask: 2400.5,
} as unknown as Instrument;

const FUTURE = {...XAU, symbol: 'ES', contractType: 'FUTURE', contractSize: 50, tickSize: 0.25} as Instrument;

function position(side: 'BUY' | 'SELL', entryPrice: number, quantity: number): Position {
  return {side, entryPrice, quantity} as unknown as Position;
}

describe('computeUnrealizedPnl', () => {
  it('marks longs at the bid and shorts at the ask', () => {
    expect(computeUnrealizedPnl(position('BUY', 2390, 0.1), XAU)).toBeCloseTo(9.5 * 0.1 * 100);
    expect(computeUnrealizedPnl(position('SELL', 2410, 0.1), XAU)).toBeCloseTo(9.5 * 0.1 * 100);
  });

  it('is negative when price moves against the position', () => {
    expect(computeUnrealizedPnl(position('BUY', 2410, 1), XAU)).toBeLessThan(0);
  });
});

describe('computeRequiredMargin', () => {
  it('divides notional by leverage and never by less than 1', () => {
    expect(computeRequiredMargin(2400, 1, 20, XAU)).toBeCloseTo(12_000);
    expect(computeRequiredMargin(2400, 1, 0, XAU)).toBeCloseTo(240_000);
  });
});

describe('computePositionSizeFromRisk', () => {
  it('sizes so the stop-loss loses exactly the risked amount', () => {
    // 1% of 10k = $100 risk; $10 stop on 100 oz contracts = $1000 per lot -> 0.1 lot.
    expect(computePositionSizeFromRisk(10_000, 1, 2400, 2390, XAU)).toBe(0.1);
  });

  it('returns 0 when the stop is on top of the entry', () => {
    expect(computePositionSizeFromRisk(10_000, 1, 2400, 2400, XAU)).toBe(0);
  });

  it('enforces the minimum lot for CFDs and whole contracts for futures', () => {
    expect(computePositionSizeFromRisk(100, 0.1, 2400, 2300, XAU)).toBe(0.01);
    expect(computePositionSizeFromRisk(100_000, 1, 5000, 4990, FUTURE)).toBe(2);
    expect(computePositionSizeFromRisk(100, 1, 5000, 4900, FUTURE)).toBe(1);
  });
});

describe('computeLiquidationPrice', () => {
  it('sits below entry for longs and above for shorts', () => {
    const longLiq = computeLiquidationPrice(2400, 'BUY', 20, XAU);
    const shortLiq = computeLiquidationPrice(2400, 'SELL', 20, XAU);
    expect(longLiq).toBeLessThan(2400);
    expect(shortLiq).toBeGreaterThan(2400);
    expect(longLiq).toBeCloseTo(2400 * (1 - (1 / 20 - 0.005)), 2);
  });
});

describe('indicators', () => {
  it('EMA starts at the SMA seed and is null before the period', () => {
    const ema = calculateEMA(candlesFromCloses([1, 2, 3, 4, 5]), 3);
    expect(ema.slice(0, 2)).toEqual([null, null]);
    expect(ema[2]).toBe(2);
    expect(ema[3]).toBeCloseTo(3);
  });

  it('RSI is 100 for a series with no losses', () => {
    const rsi = calculateRSI(candlesFromCloses(Array.from({length: 20}, (_, i) => i + 1)), 14);
    expect(rsi[13]).toBeNull();
    expect(rsi[19]).toBe(100);
  });

  it('VWAP weights typical price by volume', () => {
    const candles = [
      {time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1},
      {time: 2, open: 20, high: 20, low: 20, close: 20, volume: 3},
    ];
    expect(calculateVWAP(candles)).toEqual([10, 17.5]);
  });
});

describe('formatting', () => {
  it('formats prices with fixed decimals and currency with sign and compact units', () => {
    expect(formatPrice(2400.5, 2)).toBe('2,400.50');
    expect(formatCurrency(-1234.5)).toBe('-$1,234.50');
    expect(formatCurrency(15_300, true)).toBe('$15.3k');
    expect(formatCurrency(-2_500_000, true)).toBe('-$2.50M');
  });
});

describe('account defaults', () => {
  it('creates a clean account at the requested balance with empty books', () => {
    const acct = createCleanAccountState(5000);
    expect(JSON.stringify(acct)).toContain('5000');
    expect(createDefaultRiskSettings()).toBeTypeOf('object');
  });
});
