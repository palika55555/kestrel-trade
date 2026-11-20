import type {Dispatch, RefObject, SetStateAction} from 'react';
import type {
  AlertNotification,
  Candle,
  EconomicCalendarSnapshot,
  InstitutionalGoldContext,
  Instrument,
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
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../../types/trading';
import type {XauBotEvaluation} from '../../services/xauBot';

type Setter<T> = Dispatch<SetStateAction<T>>;

export type EmitNotification = (
  title: string,
  body: string,
  category: AlertNotification['category'],
  symbol?: string,
  chimeType?: 'alert' | 'fill' | 'warning',
) => void;

export type AppendBotLog = (level: XauBotLogEntry['level'], message: string) => void;

export type RecordClosedBotTrades = (
  newlyClosed: XauBotTradeRecord[],
  forceOptimize?: boolean,
) => void;

export interface MarketTickPayload {
  type?: string;
  timestamp: number;
  instruments: Instrument[];
}

/** Stable refs and state setters the tick engine reads/writes. */
export interface MarketTickBindings {
  hasSavedWorkspaceRef: RefObject<boolean>;
  anchoredLiveRef: RefObject<boolean>;
  selectedSymbolRef: RefObject<string>;
  timeframeRef: RefObject<Timeframe>;
  priceAlertsRef: RefObject<PriceAlert[]>;
  automationConfigRef: RefObject<NotificationAutomationConfig>;
  candlesRef: RefObject<Candle[]>;
  candlesBySymbolRef: RefObject<Record<string, Candle[]>>;
  signalCooldownRef: RefObject<Record<string, number>>;
  positionsRef: RefObject<Position[]>;
  pendingOrdersRef: RefObject<PendingOrder[]>;
  executionsRef: RefObject<TradeExecution[]>;
  cashBalanceRef: RefObject<number>;
  riskSettingsRef: RefObject<RiskSettings>;
  marginWarnedRef: RefObject<boolean>;
  securityStateRef: RefObject<SecurityState>;
  server247EnabledRef: RefObject<boolean>;
  xauBotConfigRef: RefObject<XauBotConfig>;
  xauBotLastTradeRef: RefObject<number>;
  xauBotLastHoldLogRef: RefObject<number>;
  xauPrintsRef: RefObject<MarketPrint[]>;
  xauMtfCandlesRef: RefObject<Partial<Record<Timeframe, Candle[]>>>;
  goldMacroRef: RefObject<MacroGoldContext | null>;
  institutionalGoldRef: RefObject<InstitutionalGoldContext | null>;
  latestXauEvalRef: RefObject<XauBotEvaluation | null>;
  xauBotTradesRef: RefObject<XauBotTradeRecord[]>;
  calendarSnapshotRef: RefObject<EconomicCalendarSnapshot | null>;
  setInstruments: Setter<Instrument[]>;
  setLastSyncedAt: Setter<number>;
  setCandles: Setter<Candle[]>;
  setPositions: Setter<Position[]>;
  setPendingOrders: Setter<PendingOrder[]>;
  setExecutions: Setter<TradeExecution[]>;
  setPriceAlerts: Setter<PriceAlert[]>;
  setCashBalance: Setter<number>;
  setXauBotConfig: Setter<XauBotConfig>;
}

/** Everything a single market tick evaluation needs. */
export interface MarketTickContext extends MarketTickBindings {
  setStreamConnected: Setter<boolean>;
  emitNotification: EmitNotification;
  appendBotLog: AppendBotLog;
  recordClosedBotTradesAndLearn: RecordClosedBotTrades;
}

export type InstrumentMap = Map<string, Instrument>;
