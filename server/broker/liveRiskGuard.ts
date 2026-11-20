// Hard risk limits for orders sent to a real broker account (e.g. a prop-firm challenge).
// They sit on top of the bot's own settings: the bot may ask for more, but never gets more.

export interface LiveRiskLimits {
  /** Largest allowed lot size per order. */
  maxLot: number | null;
  /** Largest loss in account currency if one trade hits its stop-loss. */
  maxRiskPerTrade: number | null;
  /** Stop opening trades once today's result is this far below zero (positive number). */
  dailyLossLimit: number | null;
  /** Never open a trade that could push equity to or below this level. */
  minEquity: number | null;
  /** Most positions open at once. */
  maxPositions: number | null;
}

export interface LiveRiskInput {
  lot: number;
  /** Stop-loss distance in price units (dollars for gold). */
  stopLossDistance: number;
  /** Account currency per 1 lot per 1 price unit (100 for XAUUSD). */
  contractSize: number;
  equity: number | null;
  /** Realized + floating result today; null when the broker could not report it. */
  dayPnl: number | null;
  /** Loss still possible on already open positions if they all hit their stop-loss. */
  openRisk: number;
  openPositions: number;
  /** Smallest lot the broker accepts. */
  minLot?: number;
}

export type LiveRiskDecision =
  | {allowed: true; lot: number; limited: boolean}
  | {allowed: false; reason: string};

const LOT_STEP = 0.01;

function readPositive(raw: string | undefined, name: string): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${text}"`);
  }
  return value;
}

export function readLiveRiskLimits(env: NodeJS.ProcessEnv = process.env): LiveRiskLimits {
  return {
    maxLot: readPositive(env.LIVE_MAX_LOT, 'LIVE_MAX_LOT'),
    maxRiskPerTrade: readPositive(env.LIVE_MAX_RISK_PER_TRADE, 'LIVE_MAX_RISK_PER_TRADE'),
    dailyLossLimit: readPositive(env.LIVE_DAILY_LOSS_LIMIT, 'LIVE_DAILY_LOSS_LIMIT'),
    minEquity: readPositive(env.LIVE_MIN_EQUITY, 'LIVE_MIN_EQUITY'),
    maxPositions: readPositive(env.LIVE_MAX_POSITIONS, 'LIVE_MAX_POSITIONS'),
  };
}

function floorToStep(value: number): number {
  return Math.floor(value / LOT_STEP + 1e-9) * LOT_STEP;
}

function roundLot(value: number): number {
  return Math.round(value * 100) / 100;
}

export function evaluateLiveRisk(limits: LiveRiskLimits, input: LiveRiskInput): LiveRiskDecision {
  const minLot = input.minLot ?? LOT_STEP;
  const perLotRisk = input.stopLossDistance * input.contractSize;
  if (!Number.isFinite(perLotRisk) || perLotRisk <= 0 || !Number.isFinite(input.lot) || input.lot <= 0) {
    return {allowed: false, reason: 'invalid lot or stop-loss distance'};
  }

  const limited = {value: false};
  let lot = input.lot;
  const cap = (max: number | null) => {
    if (max !== null && lot > max) {
      lot = max;
      limited.value = true;
    }
  };
  cap(limits.maxLot);
  if (limits.maxRiskPerTrade !== null) cap(limits.maxRiskPerTrade / perLotRisk);
  lot = roundLot(floorToStep(lot));
  if (lot < minLot) {
    return {allowed: false, reason: `risk limits leave a lot below the minimum ${minLot}`};
  }

  if (limits.maxPositions !== null && input.openPositions >= limits.maxPositions) {
    return {allowed: false, reason: `already ${input.openPositions} open position(s), limit is ${limits.maxPositions}`};
  }

  const tradeRisk = lot * perLotRisk;
  const needsEquity = limits.minEquity !== null;
  if (needsEquity && input.equity === null) {
    return {allowed: false, reason: 'broker equity is unknown, cannot check the equity floor'};
  }
  if (limits.minEquity !== null && input.equity !== null) {
    const worstCase = input.equity - input.openRisk - tradeRisk;
    if (worstCase <= limits.minEquity) {
      return {
        allowed: false,
        reason: `worst case equity ${worstCase.toFixed(2)} would reach the floor ${limits.minEquity}`,
      };
    }
  }

  if (limits.dailyLossLimit !== null) {
    if (input.dayPnl === null) {
      return {allowed: false, reason: "today's P&L is unavailable (restart the MT5 bridge)"};
    }
    const worstDay = -input.dayPnl + input.openRisk + tradeRisk;
    if (worstDay >= limits.dailyLossLimit) {
      return {
        allowed: false,
        reason: `daily loss would reach ${worstDay.toFixed(2)} (limit ${limits.dailyLossLimit}, today ${input.dayPnl.toFixed(2)})`,
      };
    }
  }

  return {allowed: true, lot, limited: limited.value};
}
