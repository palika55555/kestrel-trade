import {afterEach, describe, expect, it, vi} from 'vitest';
import {createServerBotDefaultConfig} from '../../server/botDefaults.ts';
import type {InstrumentSeed} from '../../server/instruments.ts';
import {
  TIMEFRAME_SECONDS,
  buildSyntheticOrderBook,
  fetchJsonWithTimeout,
  generateFallbackCandles,
} from '../../server/marketUtils.ts';
import {botConfigUpdateSchema} from '../../server/validation.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildSyntheticOrderBook', () => {
  it('builds 8 levels per side stepping away from the touch with cumulative totals', () => {
    const {bids, asks} = buildSyntheticOrderBook(2400, 2400.5, 0.1, 2);
    expect(bids).toHaveLength(8);
    expect(asks).toHaveLength(8);
    expect(bids[0].price).toBe(2400);
    expect(bids[7].price).toBe(2399.3);
    expect(asks[7].price).toBe(2401.2);
    expect(bids[7].total).toBe(bids.reduce((a, l) => a + l.size, 0));
  });
});

describe('generateFallbackCandles', () => {
  const seed = {decimals: 2, tickSize: 0.01} as InstrumentSeed;

  it('ends exactly at the requested price on aligned, consecutive buckets', () => {
    const candles = generateFallbackCandles(seed, '15m', 50, 2400);
    expect(candles).toHaveLength(50);
    expect(candles[49].close).toBe(2400);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].time - candles[i - 1].time).toBe(TIMEFRAME_SECONDS['15m']);
      expect(candles[i].open).toBe(candles[i - 1].close);
    }
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });
});

describe('fetchJsonWithTimeout', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok: 1}), {status: 200})));
    await expect(fetchJsonWithTimeout<{ok: number}>('https://x.test')).resolves.toEqual({ok: 1});
  });

  it('returns null on HTTP errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', {status: 503})));
    await expect(fetchJsonWithTimeout('https://x.test')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    await expect(fetchJsonWithTimeout('https://x.test')).resolves.toBeNull();
  });

  it('aborts and returns null when the timeout elapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await expect(fetchJsonWithTimeout('https://x.test', 20)).resolves.toBeNull();
  });
});

describe('createServerBotDefaultConfig', () => {
  it('starts disabled and passes the API validation schema', () => {
    const cfg = createServerBotDefaultConfig();
    expect(cfg.enabled).toBe(false);
    expect(botConfigUpdateSchema.safeParse(cfg).success).toBe(true);
  });
});
