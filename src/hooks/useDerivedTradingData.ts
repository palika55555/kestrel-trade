import {useMemo} from 'react';
import {analyzeORB} from '../services/orbAnalyzer';
import {analyzeOrderFlow} from '../services/orderFlowAnalyzer';
import {computeUnrealizedPnl} from '../services/tradingMath';
import {evaluateXauBotSignal} from '../services/xauBot';
import type {
  Candle,
  EconomicCalendarSnapshot,
  InstitutionalGoldContext,
  Instrument,
  MacroGoldContext,
  MarketPrint,
  NotificationAutomationConfig,
  ORBAnalysis,
  PendingOrder,
  Position,
  ServerBotState,
  Timeframe,
  TradeExecution,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../types/trading';

// Institutional gold analytics (COT, ETF flows, ...) only apply to spot gold and the gold future.
export function isGoldSymbol(symbol: string): boolean {
  return symbol === 'XAU/USD' || symbol === 'GC1!';
}

interface DerivedTradingInputs {
  instruments: Instrument[];
  selectedSymbol: string;
  candles: Candle[];
  candlesBySymbol: Record<string, Candle[]>;
  automationConfig: NotificationAutomationConfig;
  server247Enabled: boolean;
  serverBotState: ServerBotState | null;
  xauBotConfig: XauBotConfig;
  xauBotLogs: XauBotLogEntry[];
  xauBotTrades: XauBotTradeRecord[];
  xauRecentPrints: MarketPrint[];
  recentPrints: MarketPrint[];
  pendingOrders: PendingOrder[];
  xauMtfCandles: Partial<Record<Timeframe, Candle[]>>;
  goldMacro: MacroGoldContext | null;
  institutionalGold: InstitutionalGoldContext | null;
  calendarSnapshot: EconomicCalendarSnapshot | null;
  positions: Position[];
  executions: TradeExecution[];
  cashBalance: number;
  dayStartEquity: number;
}

/**
 * Memoized view data derived from trading state: instrument lookups, ORB and
 * order-flow analytics, active bot view (browser vs 24/7 server), merged
 * positions/executions and live account metrics.
 */
export function useDerivedTradingData({
  instruments,
  selectedSymbol,
  candles,
  candlesBySymbol,
  automationConfig,
  server247Enabled,
  serverBotState,
  xauBotConfig,
  xauBotLogs,
  xauBotTrades,
  xauRecentPrints,
  recentPrints,
  pendingOrders,
  xauMtfCandles,
  goldMacro,
  institutionalGold,
  calendarSnapshot,
  positions,
  executions,
  cashBalance,
  dayStartEquity,
}: DerivedTradingInputs) {
  const instrumentsMap = useMemo(
    () => new Map(instruments.map((i) => [i.symbol, i])),
    [instruments],
  );

  const selectedInstrument = useMemo(
    () => instrumentsMap.get(selectedSymbol) || instruments[0] || null,
    [instrumentsMap, selectedSymbol, instruments],
  );

  const activeOrbAnalysis = useMemo(() => {
    if (!selectedInstrument || candles.length < 15) return null;
    return analyzeORB(selectedInstrument, candles, automationConfig.orbWindowMinutes);
  }, [selectedInstrument, candles, automationConfig.orbWindowMinutes]);

  const orbScanner = useMemo(() => {
    const rows: ORBAnalysis[] = [];
    for (const inst of instruments) {
      const symCandles =
        inst.symbol === selectedSymbol ? candles : candlesBySymbol[inst.symbol];
      if (!symCandles || symCandles.length < 15) continue;
      const res = analyzeORB(inst, symCandles, automationConfig.orbWindowMinutes);
      if (res) rows.push(res);
    }
    return rows;
  }, [
    instruments,
    selectedSymbol,
    candles,
    candlesBySymbol,
    automationConfig.orbWindowMinutes,
  ]);

  const xauInstrument = useMemo(
    () => instrumentsMap.get('XAU/USD') || null,
    [instrumentsMap],
  );

  const activeBotConfig = useMemo(
    () =>
      server247Enabled && serverBotState
        ? serverBotState.config
        : xauBotConfig,
    [server247Enabled, serverBotState, xauBotConfig],
  );

  const activeBotTrades = useMemo(
    () =>
      server247Enabled && serverBotState
        ? serverBotState.closedTrades
        : xauBotTrades,
    [server247Enabled, serverBotState, xauBotTrades],
  );

  const xauBotEvaluation = useMemo(() => {
    if (!xauInstrument) return null;
    const rawCandles =
      selectedSymbol === 'XAU/USD' && candles.length >= 22
        ? candles
        : candlesBySymbol['XAU/USD'];
    if (!rawCandles || rawCandles.length < 22) return null;
    return evaluateXauBotSignal(
      xauInstrument,
      rawCandles,
      activeBotConfig,
      automationConfig.orbWindowMinutes,
      xauRecentPrints,
      pendingOrders,
      {
        mtfCandles: xauMtfCandles,
        macro: goldMacro,
        institutional: institutionalGold,
        calendar: calendarSnapshot,
        closedTrades: activeBotTrades,
        accountEquity: cashBalance,
      },
    );
  }, [
    xauInstrument,
    selectedSymbol,
    candles,
    candlesBySymbol,
    activeBotConfig,
    automationConfig.orbWindowMinutes,
    xauRecentPrints,
    pendingOrders,
    xauMtfCandles,
    goldMacro,
    institutionalGold,
    calendarSnapshot,
    activeBotTrades,
    cashBalance,
  ]);

  const botPositions = useMemo(() => {
    if (server247Enabled && serverBotState) {
      return serverBotState.positions;
    }
    return positions.filter((p) => p.symbol === 'XAU/USD' && p.source === 'XAU_BOT');
  }, [server247Enabled, serverBotState, positions]);

  const botExecutions = useMemo(() => {
    if (server247Enabled && serverBotState) {
      return serverBotState.executions;
    }
    return executions.filter((e) => e.source === 'XAU_BOT');
  }, [server247Enabled, serverBotState, executions]);

  const activeBotLogs = useMemo(
    () =>
      server247Enabled && serverBotState ? serverBotState.logs : xauBotLogs,
    [server247Enabled, serverBotState, xauBotLogs],
  );

  const allPositions = useMemo(() => {
    const sbPositions = serverBotState?.positions || [];
    if (sbPositions.length === 0) return positions;
    const seen = new Set(sbPositions.map((p) => p.id));
    return [...sbPositions, ...positions.filter((p) => !seen.has(p.id))];
  }, [serverBotState, positions]);

  const allExecutions = useMemo(() => {
    const sbExecs = serverBotState?.executions || [];
    if (sbExecs.length === 0) return executions;
    const seen = new Set<string>();
    const combined: TradeExecution[] = [];
    for (const ex of [...sbExecs, ...executions]) {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        combined.push(ex);
      }
    }
    return combined.sort((a, b) => b.timestamp - a.timestamp);
  }, [serverBotState, executions]);

  const orderFlowSnapshot = useMemo(() => {
    if (!selectedInstrument || candles.length < 20) return null;
    return analyzeOrderFlow(
      selectedInstrument,
      candles,
      recentPrints,
      pendingOrders,
      isGoldSymbol(selectedInstrument.symbol) ? institutionalGold : null,
    );
  }, [selectedInstrument, candles, recentPrints, pendingOrders, institutionalGold]);

  // Live Account Metrics
  const unrealizedPnl = useMemo(() => {
    return allPositions.reduce((sum, pos) => {
      const inst = instrumentsMap.get(pos.symbol);
      return sum + (inst ? computeUnrealizedPnl(pos, inst) : 0);
    }, 0);
  }, [allPositions, instrumentsMap]);

  const usedMargin = useMemo(
    () => allPositions.reduce((sum, p) => sum + p.marginUsed, 0),
    [allPositions],
  );

  const equity = cashBalance + unrealizedPnl;
  const freeMargin = Math.max(0, equity - usedMargin);
  const marginLevelPct = usedMargin > 0 ? (equity / usedMargin) * 100 : 9999;
  const dailyPnl = equity - dayStartEquity;

  return {
    instrumentsMap,
    selectedInstrument,
    activeOrbAnalysis,
    orbScanner,
    xauInstrument,
    activeBotConfig,
    xauBotEvaluation,
    botPositions,
    botExecutions,
    activeBotLogs,
    activeBotTrades,
    allPositions,
    allExecutions,
    orderFlowSnapshot,
    unrealizedPnl,
    usedMargin,
    equity,
    freeMargin,
    marginLevelPct,
    dailyPnl,
  };
}

export type DerivedTradingData = ReturnType<typeof useDerivedTradingData>;
