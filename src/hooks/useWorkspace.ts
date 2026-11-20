import {useEffect, useMemo, useRef, useState} from 'react';
import {loadWorkspace, saveWorkspace} from '../services/offlineStorage';
import {createDefaultAutomationConfig} from '../services/orbAnalyzer';
import {
  createDefaultRiskSettings,
  createDefaultSecurityState,
  createInitialSeedState,
} from '../services/tradingMath';
import {createDefaultXauBotConfig} from '../services/xauBot';
import type {
  AlertNotification,
  ChartDrawing,
  EODReport,
  Instrument,
  NotificationAutomationConfig,
  PendingOrder,
  Position,
  PriceAlert,
  RiskSettings,
  SecurityState,
  TradeExecution,
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../types/trading';

/**
 * Owns all persisted account/workspace state, hydrates it from IndexedDB on
 * startup and auto-saves it (debounced) whenever it changes.
 */
export function useWorkspace() {
  const initialSeed = useMemo(() => createInitialSeedState(), []);

  const [instruments, setInstruments] = useState<Instrument[]>([]);

  const [cashBalance, setCashBalance] = useState<number>(initialSeed.cashBalance);
  const [dayStartEquity, setDayStartEquity] = useState<number>(initialSeed.dayStartEquity);
  const [positions, setPositions] = useState<Position[]>(initialSeed.positions);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>(initialSeed.pendingOrders);
  const [executions, setExecutions] = useState<TradeExecution[]>(initialSeed.executions);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(initialSeed.priceAlerts);
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [eodReports, setEodReports] = useState<EODReport[]>(initialSeed.eodReports);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(createDefaultRiskSettings);
  const [securityState, setSecurityState] = useState<SecurityState>(createDefaultSecurityState);
  const [automationConfig, setAutomationConfig] = useState<NotificationAutomationConfig>(
    createDefaultAutomationConfig,
  );
  const [xauBotConfig, setXauBotConfig] = useState<XauBotConfig>(
    createDefaultXauBotConfig,
  );
  const [xauBotLogs, setXauBotLogs] = useState<XauBotLogEntry[]>([]);
  const [xauBotTrades, setXauBotTrades] = useState<XauBotTradeRecord[]>([]);
  const [xauBotAdaptations, setXauBotAdaptations] = useState<XauBotAdaptationEvent[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(Date.now());
  const [hydrated, setHydrated] = useState<boolean>(false);

  const hasSavedWorkspaceRef = useRef(false);
  const anchoredLiveRef = useRef(false);

  // Hydrate offline IndexedDB workspace on startup
  useEffect(() => {
    let active = true;
    loadWorkspace().then((saved) => {
      if (!active) return;
      if (saved) {
        hasSavedWorkspaceRef.current = true;
        anchoredLiveRef.current = true;
        setCashBalance(saved.cashBalance);
        setDayStartEquity(saved.dayStartEquity);
        setPositions(saved.positions);
        setPendingOrders(saved.pendingOrders);
        setExecutions(saved.executions);
        setPriceAlerts(saved.priceAlerts);
        setNotifications(saved.notifications || []);
        setEodReports(saved.eodReports);
        setRiskSettings(saved.riskSettings);
        setSecurityState(saved.securityState);
        if (saved.automationConfig) {
          setAutomationConfig(saved.automationConfig);
        }
        if (saved.xauBotConfig) {
          setXauBotConfig({...createDefaultXauBotConfig(), ...saved.xauBotConfig});
        }
        if (saved.xauBotLogs) {
          setXauBotLogs(saved.xauBotLogs);
        }
        if (saved.xauBotTrades) {
          setXauBotTrades(saved.xauBotTrades);
        }
        if (saved.xauBotAdaptations) {
          setXauBotAdaptations(saved.xauBotAdaptations);
        }
        setDrawings(saved.drawings || []);
        if (saved.cachedInstruments?.length) {
          setInstruments(saved.cachedInstruments);
        }
        setLastSyncedAt(saved.lastSyncedAt || Date.now());
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist workspace automatically to IndexedDB
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      saveWorkspace({
        cashBalance,
        dayStartEquity,
        positions,
        pendingOrders,
        executions,
        priceAlerts,
        notifications,
        eodReports,
        riskSettings,
        securityState,
        automationConfig,
        xauBotConfig,
        xauBotLogs,
        xauBotTrades,
        xauBotAdaptations,
        drawings,
        cachedInstruments: instruments,
        lastSyncedAt,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [
    hydrated,
    cashBalance,
    dayStartEquity,
    positions,
    pendingOrders,
    executions,
    priceAlerts,
    notifications,
    eodReports,
    riskSettings,
    securityState,
    automationConfig,
    xauBotConfig,
    xauBotLogs,
    xauBotTrades,
    xauBotAdaptations,
    drawings,
    instruments,
    lastSyncedAt,
  ]);

  return {
    hydrated,
    hasSavedWorkspaceRef,
    anchoredLiveRef,
    instruments,
    setInstruments,
    cashBalance,
    setCashBalance,
    dayStartEquity,
    setDayStartEquity,
    positions,
    setPositions,
    pendingOrders,
    setPendingOrders,
    executions,
    setExecutions,
    priceAlerts,
    setPriceAlerts,
    notifications,
    setNotifications,
    eodReports,
    setEodReports,
    riskSettings,
    setRiskSettings,
    securityState,
    setSecurityState,
    automationConfig,
    setAutomationConfig,
    xauBotConfig,
    setXauBotConfig,
    xauBotLogs,
    setXauBotLogs,
    xauBotTrades,
    setXauBotTrades,
    xauBotAdaptations,
    setXauBotAdaptations,
    drawings,
    setDrawings,
    lastSyncedAt,
    setLastSyncedAt,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
