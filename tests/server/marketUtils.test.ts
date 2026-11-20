import {describe, expect, it} from 'vitest';
import {
  MAX_QUOTE_AGE_MS,
  aggregateCandles4H,
  bratislavaDay,
  isQuoteStale,
  roundToDecimals,
  serverEmaLast,
  serverRsiLast,
} from '../../server/marketUtils.ts';
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
