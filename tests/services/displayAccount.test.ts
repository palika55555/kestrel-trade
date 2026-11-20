import {describe, expect, it} from 'vitest';
import {type AccountFigures, resolveDisplayAccount} from '../../src/services/displayAccount.ts';
import type {BrokerStatus} from '../../src/types/trading.ts';

const PAPER: AccountFigures = {
  cashBalance: 10_000,
  dayStartEquity: 10_000,
  equity: 10_000,
  usedMargin: 0,
  freeMargin: 10_000,
  marginLevelPct: 0,
  unrealizedPnl: 0,
  dailyPnl: 0,
};

function broker(overrides: Partial<BrokerStatus> = {}): BrokerStatus {
  return {
    provider: 'MT5',
    configured: true,
    environment: 'live',
    routingArmed: true,
    accountLabel: 'Blue Guardian #633110',
    currency: 'USD',
    balance: 4991.12,
    equity: 5041.12,
    unrealizedPnl: 50,
    marginUsed: 100,
    dayPnl: 42,
    openPositionsCount: 1,
    lastSyncedAt: 1,
    lastOrderSummary: null,
    lastError: null,
    ...overrides,
  };
}

describe('resolveDisplayAccount', () => {
  it('shows the paper ledger when routing is not armed', () => {
    const view = resolveDisplayAccount(PAPER, broker({routingArmed: false}));
    expect(view.source).toBe('PAPER');
    expect(view.equity).toBe(10_000);
  });

  it('shows the paper ledger before the broker has synced or without a broker', () => {
    expect(resolveDisplayAccount(PAPER, null).source).toBe('PAPER');
    expect(resolveDisplayAccount(PAPER, broker({equity: null, balance: null})).source).toBe('PAPER');
    expect(resolveDisplayAccount(PAPER, broker({provider: 'SIMULATION'})).source).toBe('PAPER');
  });

  it('shows broker figures when live routing is armed', () => {
    const view = resolveDisplayAccount(PAPER, broker());
    expect(view.source).toBe('BROKER');
    expect(view.sourceLabel).toBe('Blue Guardian #633110');
    expect(view.equity).toBe(5041.12);
    expect(view.cashBalance).toBe(4991.12);
    expect(view.freeMargin).toBe(4941.12);
    expect(view.marginLevelPct).toBeCloseTo(5041.12);
    expect(view.dailyPnl).toBe(42);
    expect(view.dayStartEquity).toBeCloseTo(4999.12, 2);
  });

  it('drops the server name in parentheses from the label', () => {
    const view = resolveDisplayAccount(PAPER, broker({accountLabel: 'Blue Guardian Limited #633110 (BlueGuardian-Server)'}));
    expect(view.sourceLabel).toBe('Blue Guardian Limited #633110');
  });

  it('falls back to floating P&L when the broker reports no day P&L', () => {
    const view = resolveDisplayAccount(PAPER, broker({dayPnl: null}));
    expect(view.dailyPnl).toBe(50);
  });

  it('reports a zero margin level when no margin is used', () => {
    const view = resolveDisplayAccount(PAPER, broker({marginUsed: 0}));
    expect(view.usedMargin).toBe(0);
    expect(view.marginLevelPct).toBe(0);
  });
});
