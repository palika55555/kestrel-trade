import {useRef} from 'react';
import type {
  Candle,
  EconomicCalendarSnapshot,
  InstitutionalGoldContext,
  MacroGoldContext,
  MarketPrint,
  NotificationAutomationConfig,
  PendingOrder,
  Position,
  PriceAlert,
  RiskSettings,
  SecurityState,
  Timeframe,
  TradeExecution,
  XauBotConfig,
  XauBotTradeRecord,
} from '../types/trading';
import type {XauBotEvaluation} from '../services/xauBot';

interface LiveValues {
  positions: Position[];
  pendingOrders: PendingOrder[];
  priceAlerts: PriceAlert[];
  selectedSymbol: string;
  timeframe: Timeframe;
  riskSettings: RiskSettings;
  cashBalance: number;
  automationConfig: NotificationAutomationConfig;
  executions: TradeExecution[];
  securityState: SecurityState;
  xauBotConfig: XauBotConfig;
  xauBotTrades: XauBotTradeRecord[];
  xauRecentPrints: MarketPrint[];
  xauMtfCandles: Partial<Record<Timeframe, Candle[]>>;
  goldMacro: MacroGoldContext | null;
  institutionalGold: InstitutionalGoldContext | null;
  calendarSnapshot: EconomicCalendarSnapshot | null;
}

/**
 * Refs mirroring the latest render's state, read by the SSE tick handler and
 * long-lived callbacks to avoid stale closures, plus the bot/alert engine's
 * own mutable bookkeeping refs.
 */
export function useLiveRefs({
  positions,
  pendingOrders,
  priceAlerts,
  selectedSymbol,
  timeframe,
  riskSettings,
  cashBalance,
  automationConfig,
  executions,
  securityState,
  xauBotConfig,
  xauBotTrades,
  xauRecentPrints,
  xauMtfCandles,
  goldMacro,
  institutionalGold,
  calendarSnapshot,
}: LiveValues) {
  // Refs for automated risk / alert evaluation inside SSE tick handler
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const pendingOrdersRef = useRef(pendingOrders);
  pendingOrdersRef.current = pendingOrders;
  const priceAlertsRef = useRef(priceAlerts);
  priceAlertsRef.current = priceAlerts;
  const selectedSymbolRef = useRef(selectedSymbol);
  selectedSymbolRef.current = selectedSymbol;
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const riskSettingsRef = useRef(riskSettings);
  riskSettingsRef.current = riskSettings;
  const cashBalanceRef = useRef(cashBalance);
  cashBalanceRef.current = cashBalance;
  const automationConfigRef = useRef(automationConfig);
  automationConfigRef.current = automationConfig;
  const executionsRef = useRef(executions);
  executionsRef.current = executions;
  const securityStateRef = useRef(securityState);
  securityStateRef.current = securityState;
  const xauBotConfigRef = useRef(xauBotConfig);
  xauBotConfigRef.current = xauBotConfig;
  const xauBotTradesRef = useRef(xauBotTrades);
  xauBotTradesRef.current = xauBotTrades;
  const xauPrintsRef = useRef(xauRecentPrints);
  xauPrintsRef.current = xauRecentPrints;
  const xauMtfCandlesRef = useRef(xauMtfCandles);
  xauMtfCandlesRef.current = xauMtfCandles;
  const goldMacroRef = useRef(goldMacro);
  goldMacroRef.current = goldMacro;
  const institutionalGoldRef = useRef(institutionalGold);
  institutionalGoldRef.current = institutionalGold;
  const calendarSnapshotRef = useRef(calendarSnapshot);
  calendarSnapshotRef.current = calendarSnapshot;
  // Latest browser-side XAU evaluation, read by the early-exit check in the tick handler.
  const latestXauEvalRef = useRef<XauBotEvaluation | null>(null);
  const xauBotLastTradeRef = useRef<number>(0);
  const xauBotLastHoldLogRef = useRef<number>(0);
  const signalCooldownRef = useRef<Record<string, number>>({});
  const marginWarnedRef = useRef(false);

  return {
    positionsRef,
    pendingOrdersRef,
    priceAlertsRef,
    selectedSymbolRef,
    timeframeRef,
    riskSettingsRef,
    cashBalanceRef,
    automationConfigRef,
    executionsRef,
    securityStateRef,
    xauBotConfigRef,
    xauBotTradesRef,
    xauPrintsRef,
    xauMtfCandlesRef,
    goldMacroRef,
    institutionalGoldRef,
    calendarSnapshotRef,
    latestXauEvalRef,
    xauBotLastTradeRef,
    xauBotLastHoldLogRef,
    signalCooldownRef,
    marginWarnedRef,
  };
}

export type LiveRefs = ReturnType<typeof useLiveRefs>;
