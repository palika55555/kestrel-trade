import type {Candle} from '../src/types/trading.ts';

export function candlesFromCloses(closes: number[], startTime = 1_700_000_000, stepSec = 60): Candle[] {
  return closes.map((close, i) => ({
    time: startTime + i * stepSec,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}
