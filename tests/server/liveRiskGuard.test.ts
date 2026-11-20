import {describe, expect, it} from 'vitest';
import {
  type LiveRiskInput,
  type LiveRiskLimits,
  evaluateLiveRisk,
  readLiveRiskLimits,
} from '../../server/broker/liveRiskGuard.ts';

const LIMITS: LiveRiskLimits = {
  maxLot: 0.05,
  maxRiskPerTrade: 25,
  dailyLossLimit: 100,
  minEquity: 4800,
  maxPositions: 2,
};

function input(overrides: Partial<LiveRiskInput> = {}): LiveRiskInput {
  return {
    lot: 0.1,
    stopLossDistance: 8,
    contractSize: 100,
    equity: 4991.12,
    dayPnl: 0,
    openRisk: 0,
    openPositions: 0,
    ...overrides,
  };
}

describe('readLiveRiskLimits', () => {
  it('leaves unset limits open and parses numbers', () => {
    expect(readLiveRiskLimits({})).toEqual({
      maxLot: null,
      maxRiskPerTrade: null,
      dailyLossLimit: null,
      minEquity: null,
      maxPositions: null,
    });
    expect(readLiveRiskLimits({LIVE_MAX_LOT: '0.05', LIVE_DAILY_LOSS_LIMIT: ' 100 '}).dailyLossLimit).toBe(100);
  });

  it('rejects non-numeric or non-positive values instead of silently ignoring them', () => {
    expect(() => readLiveRiskLimits({LIVE_MAX_LOT: 'abc'})).toThrow(/LIVE_MAX_LOT/);
    expect(() => readLiveRiskLimits({LIVE_MIN_EQUITY: '-5'})).toThrow(/LIVE_MIN_EQUITY/);
  });
});

describe('evaluateLiveRisk', () => {
  it('cuts the lot down to the per-trade risk and max lot', () => {
    // 0.1 lot x $8 SL = $80 risk; $25 cap allows 0.03 lot ($24)
    expect(evaluateLiveRisk(LIMITS, input())).toEqual({allowed: true, lot: 0.03, limited: true});
  });

  it('passes a small order through unchanged', () => {
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02}))).toEqual({allowed: true, lot: 0.02, limited: false});
  });

  it('blocks when the stop is so wide that even the minimum lot exceeds the risk cap', () => {
    const res = evaluateLiveRisk(LIMITS, input({stopLossDistance: 40}));
    expect(res.allowed).toBe(false);
  });

  it('blocks once the maximum number of positions is open', () => {
    const res = evaluateLiveRisk(LIMITS, input({openPositions: 2}));
    expect(res).toMatchObject({allowed: false});
  });

  it('blocks when today is already near the daily loss limit', () => {
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02, dayPnl: -90}))).toMatchObject({allowed: false});
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02, dayPnl: -50}))).toMatchObject({allowed: true});
  });

  it('counts the stop-loss risk of positions that are already open', () => {
    // -60 today + 30 still at risk + 16 new = 106 >= 100
    const res = evaluateLiveRisk(LIMITS, input({lot: 0.02, dayPnl: -60, openRisk: 30}));
    expect(res).toMatchObject({allowed: false});
  });

  it('refuses to trade when today P&L is unknown but a daily limit is set', () => {
    const res = evaluateLiveRisk(LIMITS, input({dayPnl: null}));
    expect(res).toMatchObject({allowed: false});
    expect((res as {reason: string}).reason).toMatch(/restart the MT5 bridge/);
  });

  it('protects the equity floor including open risk', () => {
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02, equity: 4815}))).toMatchObject({allowed: false});
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02, equity: 4840, openRisk: 30}))).toMatchObject({allowed: false});
    expect(evaluateLiveRisk(LIMITS, input({lot: 0.02, equity: 4990}))).toMatchObject({allowed: true});
  });

  it('refuses to trade without equity when an equity floor is set', () => {
    expect(evaluateLiveRisk(LIMITS, input({equity: null}))).toMatchObject({allowed: false});
  });

  it('rejects invalid inputs', () => {
    expect(evaluateLiveRisk(LIMITS, input({lot: Number.NaN}))).toMatchObject({allowed: false});
    expect(evaluateLiveRisk(LIMITS, input({stopLossDistance: 0}))).toMatchObject({allowed: false});
  });
});
