import type {BrokerStatus} from '../types/trading';

export interface AccountFigures {
  cashBalance: number;
  dayStartEquity: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  marginLevelPct: number;
  unrealizedPnl: number;
  dailyPnl: number;
}

export interface DisplayAccount extends AccountFigures {
  source: 'PAPER' | 'BROKER';
  /** Short name of the account shown in the UI, e.g. "MT5 #633110". */
  sourceLabel: string;
}

/**
 * Chooses which account the header and portfolio summary describe. While live routing is armed
 * and the broker account has been synced, they show the real broker numbers; otherwise the
 * paper simulation ledger.
 */
export function resolveDisplayAccount(paper: AccountFigures, broker: BrokerStatus | null): DisplayAccount {
  const live =
    broker !== null &&
    broker.routingArmed &&
    broker.provider !== 'SIMULATION' &&
    broker.balance !== null &&
    broker.equity !== null;
  if (!live) return {...paper, source: 'PAPER', sourceLabel: 'Paper'};

  const equity = broker.equity as number;
  const balance = broker.balance as number;
  const usedMargin = broker.marginUsed ?? 0;
  const unrealizedPnl = broker.unrealizedPnl ?? equity - balance;
  const dailyPnl = broker.dayPnl ?? unrealizedPnl;
  return {
    source: 'BROKER',
    sourceLabel: broker.accountLabel.replace(/\s*\([^)]*\)\s*$/, ''),
    cashBalance: balance,
    equity,
    unrealizedPnl,
    usedMargin,
    freeMargin: equity - usedMargin,
    marginLevelPct: usedMargin > 0 ? (equity / usedMargin) * 100 : 0,
    dailyPnl,
    dayStartEquity: equity - dailyPnl,
  };
}
