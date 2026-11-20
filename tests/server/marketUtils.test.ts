import {describe, expect, it} from 'vitest';
import {
  MAX_QUOTE_AGE_MS,
  aggregateCandles4H,
  bratislavaDay,
  classifyDomWallVelocity,
  classifyFuturesOiRegime,
  computeOvernightSwapPnl,
  computeServerVolumeProfile,
  computeSessionOrbRange,
  detectSilverGoldSmt,
  isQuoteStale,
  roundToDecimals,
  serverEmaLast,
  serverRsiLast,
} from '../../server/marketUtils.ts';
import {SEEDS} from '../../server/instruments.ts';
import {candlesFromCloses} from '../helpers.ts';

describe('isQuoteStale', () => {
  const now = 1_700_000_000_000;

  it('is stale when no live quote was ever received', () => {
    expect(isQuoteStale(0, now)).toBe(true);
  });

  it('is fresh within the max age and stale after it', () => {
    expect(isQuoteStale(now - MAX_QUOTE_AGE_MS, now)).toBe(false);
    expect(isQuoteStale(now - MAX_QUOTE_AGE_MS - 1, now)).toBe(true);
  });

  it('honours a custom max age', () => {
    expect(isQuoteStale(now - 5_000, now, 1_000)).toBe(true);
  });
});

describe('roundToDecimals', () => {
  it('rounds to the requested precision', () => {
    expect(roundToDecimals(2345.6789, 2)).toBe(2345.68);
    expect(roundToDecimals(1.23456, 4)).toBe(1.2346);
    expect(roundToDecimals(7.5, 0)).toBe(8);
  });
});

describe('bratislavaDay', () => {
  it('uses Slovak local midnight, not UTC', () => {
    // 2026-03-10 23:30 UTC is already 2026-03-11 00:30 in Bratislava (CET, UTC+1).
    expect(bratislavaDay(Date.UTC(2026, 2, 10, 23, 30))).toBe('2026-03-11');
    expect(bratislavaDay(Date.UTC(2026, 2, 10, 22, 30))).toBe('2026-03-10');
  });
});

describe('aggregateCandles4H', () => {
  it('merges hourly candles into 4h buckets with correct OHLCV', () => {
    const base = 14400 * 100_000;
    const hourly = [
      {time: base, open: 10, high: 12, low: 9, close: 11, volume: 1},
      {time: base + 3600, open: 11, high: 15, low: 10, close: 14, volume: 2},
      {time: base + 14400, open: 14, high: 14, low: 13, close: 13, volume: 3},
    ];
    expect(aggregateCandles4H(hourly)).toEqual([
      {time: base, open: 10, high: 15, low: 9, close: 14, volume: 3},
      {time: base + 14400, open: 14, high: 14, low: 13, close: 13, volume: 3},
    ]);
  });

  it('does not mutate the input candles', () => {
    const hourly = candlesFromCloses([1, 2], 14400 * 5, 3600);
    const snapshot = JSON.stringify(hourly);
    aggregateCandles4H(hourly);
    expect(JSON.stringify(hourly)).toBe(snapshot);
  });
});

describe('serverEmaLast / serverRsiLast', () => {
  it('EMA of a flat series equals the price', () => {
    expect(serverEmaLast(candlesFromCloses(Array(30).fill(2000)), 9)).toBeCloseTo(2000);
    expect(serverEmaLast([], 9)).toBe(0);
  });

  it('RSI is neutral without enough data and high in a steady uptrend', () => {
    expect(serverRsiLast(candlesFromCloses([1, 2, 3]), 14)).toBe(50);
    const up = candlesFromCloses(Array.from({length: 30}, (_, i) => 2000 + i));
    expect(serverRsiLast(up, 14)).toBe(75);
    const zigzagDown = candlesFromCloses(Array.from({length: 30}, (_, i) => 2000 - i * 2 + (i % 2)));
    expect(serverRsiLast(zigzagDown, 14)).toBeLessThan(30);
  });
});

describe('computeSessionOrbRange & computeServerVolumeProfile', () => {
  it('anchors ORB at the London 07:00 UTC open boundary', () => {
    // Build 5m bars from 06:30 UTC to 08:00 UTC (18 bars)
    const startSec = Math.floor(Date.UTC(2026, 2, 10, 6, 30) / 1000);
    const bars = Array.from({length: 18}, (_, i) => {
      const t = startSec + i * 300;
      const isLondonOpen = i >= 6 && i < 9; // 07:00, 07:05, 07:10 UTC
      return {
        time: t,
        open: 3000,
        high: isLondonOpen ? 3012 : 3003,
        low: isLondonOpen ? 2992 : 2998,
        close: 3002,
        volume: 150,
      };
    });
    const orb = computeSessionOrbRange(bars, 15);
    expect(orb.orHigh).toBe(3012);
    expect(orb.orLow).toBe(2992);
    expect(orb.orMid).toBe(3002);
  });

  it('computes ordered VAL <= POC <= VAH and detects stacked buying imbalance', () => {
    const startSec = 1_700_000_000;
    const bars = Array.from({length: 25}, (_, i) => ({
      time: startSec + i * 300,
      open: 3000 + i * 0.6,
      high: 3002 + i * 0.6,
      low: 2999.8 + i * 0.6,
      close: 3001.9 + i * 0.6, // strongly near high -> heavy aggressive buys
      volume: 300,
    }));
    const vp = computeServerVolumeProfile(bars, 0.05);
    expect(vp.val).toBeLessThanOrEqual(vp.poc);
    expect(vp.poc).toBeLessThanOrEqual(vp.vah);
    expect(vp.stackedImbalance).toBe('BULLISH_STACK');
  });
});

describe('detectSilverGoldSmt', () => {
  it('detects BULLISH_SMT when Gold sweeps a lower low while Silver holds a higher low', () => {
    const gold = Array.from({length: 20}, (_, i) => ({
      time: 1_700_000_000 + i * 300,
      open: 3500,
      high: 3505,
      low: i === 15 ? 3488 : 3495, // recent half prints lower low
      close: 3501,
      volume: 100,
    }));
    const silver = Array.from({length: 20}, (_, i) => ({
      time: 1_700_000_000 + i * 300,
      open: 40.5,
      high: 40.9,
      low: i === 4 ? 39.8 : i >= 10 ? 40.3 : 40.1, // recent half holds higher low
      close: 40.6,
      volume: 100,
    }));
    expect(detectSilverGoldSmt(gold, silver)).toBe('BULLISH_SMT');
  });

  it('detects BEARISH_SMT when Gold prints a higher high while Silver prints a lower high', () => {
    const gold = Array.from({length: 20}, (_, i) => ({
      time: 1_700_000_000 + i * 300,
      open: 3500,
      high: i === 16 ? 3525 : 3508, // recent half higher high
      low: 3496,
      close: 3500,
      volume: 100,
    }));
    const silver = Array.from({length: 20}, (_, i) => ({
      time: 1_700_000_000 + i * 300,
      open: 40.5,
      high: i === 3 ? 41.5 : i >= 10 ? 40.8 : 41.0, // recent half lower high
      low: 40.0,
      close: 40.4,
      volume: 100,
    }));
    expect(detectSilverGoldSmt(gold, silver)).toBe('BEARISH_SMT');
  });
});

describe('classifyFuturesOiRegime & classifyDomWallVelocity', () => {
  it('classifies Futures OI + Price regimes accurately', () => {
    expect(classifyFuturesOiRegime(0.18, 0.65)).toBe('NEW_LONGS');
    expect(classifyFuturesOiRegime(-0.15, 0.55)).toBe('NEW_SHORTS');
    expect(classifyFuturesOiRegime(0.22, -0.75)).toBe('SHORT_COVERING');
    expect(classifyFuturesOiRegime(-0.25, -0.8)).toBe('LONG_LIQUIDATION');
    expect(classifyFuturesOiRegime(0.01, 0.05)).toBe('NEUTRAL');
  });

  it('detects Ask spoof pulling vs Bid stacking in DOM velocity', () => {
    expect(classifyDomWallVelocity(10, 12, 10.5, 8).velocity).toBe('PULLING_ASKS');
    expect(classifyDomWallVelocity(10, 12, 14.2, 12.1).velocity).toBe('STACKING_BIDS');
    expect(classifyDomWallVelocity(10, 12, 7.1, 12.2).velocity).toBe('PULLING_BIDS');
    expect(classifyDomWallVelocity(10, 12, 10.1, 16.5).velocity).toBe('STACKING_ASKS');
    expect(classifyDomWallVelocity(10, 12, 10.2, 12.1).velocity).toBe('BALANCED');
  });
});

describe('ECN commission & overnight rollover swap', () => {
  it('configures realistic ECN commission on XAU/USD', () => {
    const xau = SEEDS.find((s) => s.symbol === 'XAU/USD');
    expect(xau?.commissionPerUnit).toBe(3.5);
  });

  it('returns 0 swap for intraday trades and charges weekday 22:00 UTC rollovers', () => {
    const tOpen = Date.UTC(2026, 10, 18, 10, 0, 0); // Wed 10:00 UTC
    const tSameDay = Date.UTC(2026, 10, 18, 21, 30, 0); // Wed 21:30 UTC
    const tNextDay = Date.UTC(2026, 10, 19, 10, 0, 0); // Thu 10:00 UTC (1 rollover)
    const tFri = Date.UTC(2026, 10, 20, 10, 0, 0); // Fri 10:00 UTC (2 rollovers)

    expect(computeOvernightSwapPnl('BUY', 0.1, tOpen, tSameDay, -11.4, 3.2)).toBe(0);
    expect(computeOvernightSwapPnl('BUY', 0.1, tOpen, tNextDay, -11.4, 3.2)).toBe(-1.14);
    expect(computeOvernightSwapPnl('BUY', 0.1, tOpen, tFri, -11.4, 3.2)).toBe(-2.28);
    expect(computeOvernightSwapPnl('SELL', 0.1, tOpen, tFri, -11.4, 3.2)).toBe(0.64);
  });
});
