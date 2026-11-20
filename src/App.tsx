import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Moon, Sun, Wifi, WifiOff, X} from 'lucide-react';
import {AdvancedChart} from './components/AdvancedChart';
import {AlertsCenter} from './components/AlertsCenter';
import {BotStatsView} from './components/BotStatsView';
import {EconomicCalendarPanel} from './components/EconomicCalendarPanel';
import {EODReportsView} from './components/EODReportsView';
import {MarketWatchlist} from './components/MarketWatchlist';
import {OfflineIndicator} from './components/OfflineIndicator';
import {ORBAnalysisPanel} from './components/ORBAnalysisPanel';
import {OrderBookDepth} from './components/OrderBookDepth';
import {OrderFlowPanel} from './components/OrderFlowPanel';
import {OrderTicket} from './components/OrderTicket';
import {PortfolioView} from './components/PortfolioView';
import {PositionsBlotter} from './components/PositionsBlotter';
import {PWAInstallButton} from './components/PWAInstallButton';
import {SecurityLockModal} from './components/SecurityLockModal';
import {SecurityView} from './components/SecurityView';
import {TopBar} from './components/TopBar';
import {XauAutoBotPanel} from './components/XauAutoBotPanel';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {
  dispatchBrowserPushNotification,
  getNotificationPermission,
  playAlertChime,
  requestNotificationPermission,
  type PushPermissionState,
} from './services/notifications';
import {
  loadCachedCandles,
  loadWorkspace,
  saveCachedCandles,
  saveWorkspace,
} from './services/offlineStorage';
import {
  analyzeORB,
  createDefaultAutomationConfig,
} from './services/orbAnalyzer';
import {analyzeOrderFlow} from './services/orderFlowAnalyzer';
import {
  computeRequiredMargin,
  computeUnrealizedPnl,
  createCleanAccountState,
  createDefaultRiskSettings,
  createDefaultSecurityState,
  createInitialSeedState,
  formatCurrency,
  formatPrice,
} from './services/tradingMath';
import {
  adaptBotFromTradeHistory,
  createDefaultXauBotConfig,
  evaluateMultiTradeEntry,
  evaluateXauBotSignal,
  shouldEarlyExitPosition,
  type XauBotEvaluation,
} from './services/xauBot';
import type {
  ActiveTab,
  AlertNotification,
  BrokerStatus,
  Candle,
  ChartDrawing,
  EconomicCalendarSnapshot,
  EODReport,
  ExecutionAction,
  InstitutionalGoldContext,
  Instrument,
  MacroGoldContext,
  MarketPrint,
  NotificationAutomationConfig,
  ORBAnalysis,
  OrderSide,
  OrderType,
  PendingOrder,
  Position,
  PriceAlert,
  RiskSettings,
  SecurityState,
  ServerBotState,
  StagedOrderPreset,
  Timeframe,
  TradeExecution,
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotLogEntry,
  XauBotStrategy,
  XauBotTradeRecord,
} from './types/trading';

interface PendingOrderPayload {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  triggerPrice?: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopDistance: number | null;
  source?: 'MANUAL' | 'XAU_BOT';
  note?: string;
  botStrategy?: XauBotStrategy;
  botConfidence?: number;
}

export default function App() {
  const {isOnline, simulatedOffline, setSimulatedOffline} = useOnlineStatus();

  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    const saved = localStorage.getItem('kestrel_theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('kestrel_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const [activeTab, setActiveTab] = useState<ActiveTab>('trade');
  const [mobileTradePanel, setMobileTradePanel] = useState<'CHART' | 'MARKETS' | 'ORDER'>('CHART');

  const initialSeed = useMemo(() => createInitialSeedState(), []);

  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('XAU/USD');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [candles, setCandles] = useState<Candle[]>([]);

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
  const [centerSubTab, setCenterSubTab] = useState<'XAU_BOT' | 'ORDER_FLOW' | 'ORB' | 'CALENDAR'>('XAU_BOT');
  const [recentPrints, setRecentPrints] = useState<MarketPrint[]>([]);
  const [xauRecentPrints, setXauRecentPrints] = useState<MarketPrint[]>([]);
  const [xauMtfCandles, setXauMtfCandles] = useState<Partial<Record<Timeframe, Candle[]>>>({});
  const [goldMacro, setGoldMacro] = useState<MacroGoldContext | null>(null);
  const [institutionalGold, setInstitutionalGold] = useState<InstitutionalGoldContext | null>(null);
  const [calendarSnapshot, setCalendarSnapshot] = useState<EconomicCalendarSnapshot | null>(null);
  const [server247Enabled, setServer247Enabled] = useState<boolean>(false);
  const [serverBotState, setServerBotState] = useState<ServerBotState | null>(null);
  const [multiMachineDetected, setMultiMachineDetected] = useState<boolean>(false);
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [candlesBySymbol, setCandlesBySymbol] = useState<Record<string, Candle[]>>({});
  const [stagedOrderPreset, setStagedOrderPreset] = useState<StagedOrderPreset | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(Date.now());
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  const [pushPermission, setPushPermission] = useState<PushPermissionState>(() =>
    getNotificationPermission(),
  );
  const [externalLimitPrice, setExternalLimitPrice] = useState<number | null>(null);
  const [toastQueue, setToastQueue] = useState<AlertNotification[]>([]);
  const [pendingBiometricOrder, setPendingBiometricOrder] =
    useState<PendingOrderPayload | null>(null);

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

  const emitNotification = useCallback(
    (
      title: string,
      body: string,
      category: AlertNotification['category'],
      symbol?: string,
      chimeType: 'alert' | 'fill' | 'warning' = 'alert',
    ) => {
      const note: AlertNotification = {
        id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        category,
        symbol,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications((prev) => [note, ...prev].slice(0, 80));
      setToastQueue((prev) => [note, ...prev].slice(0, 3));
      setTimeout(() => {
        setToastQueue((prev) => prev.filter((t) => t.id !== note.id));
      }, 5200);

      if (riskSettings.enableAudioChime) {
        playAlertChime(chimeType);
      }
      if (riskSettings.enablePushNotifications) {
        dispatchBrowserPushNotification(title, body, note.id);
      }
    },
    [riskSettings.enableAudioChime, riskSettings.enablePushNotifications],
  );

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
  const candlesBySymbolRef = useRef(candlesBySymbol);
  candlesBySymbolRef.current = candlesBySymbol;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
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
  const latestXauEvalRef = useRef<XauBotEvaluation | null>(null);
  const server247EnabledRef = useRef(server247Enabled);
  server247EnabledRef.current = server247Enabled;
  const seenMachineIdsRef = useRef<Set<string>>(new Set());
  const restoredBootIdsRef = useRef<Set<string>>(new Set());
  const botMutationStampRef = useRef<number>(0);
  const userChoseBrowserModeRef = useRef<boolean>(false);
  const xauBotLastTradeRef = useRef<number>(0);
  const xauBotLastHoldLogRef = useRef<number>(0);
  const signalCooldownRef = useRef<Record<string, number>>({});
  const marginWarnedRef = useRef(false);

  const appendBotLog = useCallback(
    (level: XauBotLogEntry['level'], message: string) => {
      const entry: XauBotLogEntry = {
        id: `botlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        level,
        message,
      };
      setXauBotLogs((prev) => [entry, ...prev].slice(0, 60));
    },
    [],
  );

  const recordClosedBotTradesAndLearn = useCallback(
    (newlyClosed: XauBotTradeRecord[], forceOptimize = false) => {
      const combined = [...newlyClosed, ...xauBotTradesRef.current].slice(0, 250);
      if (newlyClosed.length > 0) {
        setXauBotTrades(combined);
      }

      const currentCfg = xauBotConfigRef.current;
      if ((currentCfg.autoLearnEnabled || forceOptimize) && combined.length >= 2) {
        const {nextConfig, event} = adaptBotFromTradeHistory(currentCfg, combined);
        if (event) {
          setXauBotConfig(nextConfig);
          setXauBotAdaptations((prev) => [event, ...prev].slice(0, 60));
          appendBotLog(
            'LEARN',
            `Auto-improved after #${event.triggerTradeCount}: ${event.summary} (${event.reason})`,
          );
          emitNotification(
            'XAU/USD Bot Self-Optimized',
            event.summary,
            'SYSTEM',
            'XAU/USD',
            'alert',
          );
        } else if (forceOptimize) {
          appendBotLog(
            'LEARN',
            'Optimization check complete: current parameters already match recent performance.',
          );
        }
      }
    },
    [appendBotLog, emitNotification],
  );

  // Fetch candles when symbol or timeframe changes (with IndexedDB offline fallback)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cached = await loadCachedCandles(selectedSymbol, timeframe);
      if (cached && cached.length > 0 && !cancelled) {
        setCandles(cached);
        setCandlesBySymbol((prev) => ({...prev, [selectedSymbol]: cached}));
      }
      if (!isOnline) return;
      try {
        const res = await fetch(
          `/api/candles/${encodeURIComponent(selectedSymbol)}?timeframe=${timeframe}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {candles: Candle[]};
        if (!cancelled && data.candles?.length) {
          setCandles(data.candles);
          setCandlesBySymbol((prev) => ({...prev, [selectedSymbol]: data.candles}));
          saveCachedCandles(selectedSymbol, timeframe, data.candles);
        }
      } catch {
        // Retain cached candles if offline
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, timeframe, isOnline]);

  // Background-fetch 5m candles for all instruments to power Multi-Asset ORB Scanner & Notification Automation
  useEffect(() => {
    if (!isOnline || instruments.length === 0) return;
    let cancelled = false;
    const missing = instruments.filter((i) => !candlesBySymbolRef.current[i.symbol]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (inst) => {
        try {
          const res = await fetch(
            `/api/candles/${encodeURIComponent(inst.symbol)}?timeframe=5m`,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as {candles: Candle[]};
          return {symbol: inst.symbol, candles: data.candles};
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const patch: Record<string, Candle[]> = {};
      results.forEach((r) => {
        if (r && r.candles?.length) patch[r.symbol] = r.candles;
      });
      if (Object.keys(patch).length > 0) {
        setCandlesBySymbol((prev) => ({...prev, ...patch}));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOnline, instruments.length]);

  // Connect to Real-Time SSE Market Stream when online (with automatic HTTP/2 fallback to /api/markets)
  useEffect(() => {
    if (!isOnline) {
      setStreamConnected(false);
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retrySseTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveSseErrors = 0;

    const processMarketTick = (payload: {
      type?: string;
      timestamp: number;
      instruments: Instrument[];
    }) => {
      try {
        if (!payload.instruments?.length) return;

        setStreamConnected(true);
        setInstruments(payload.instruments);
        setLastSyncedAt(payload.timestamp);

        if (!hasSavedWorkspaceRef.current && !anchoredLiveRef.current) {
          anchoredLiveRef.current = true;
          const liveSeed = createInitialSeedState(payload.instruments);
          setPositions(liveSeed.positions);
          setPendingOrders(liveSeed.pendingOrders);
          setExecutions(liveSeed.executions);
          setPriceAlerts(liveSeed.priceAlerts);
        }

        const instMap = new Map(payload.instruments.map((i) => [i.symbol, i]));

        // Update current live candle on chart
        const activeInst = instMap.get(selectedSymbolRef.current);
        if (activeInst) {
          const tfSecondsMap: Record<Timeframe, number> = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1H': 3600,
            '4H': 14400,
            '1D': 86400,
          };
          const tfSec = tfSecondsMap[timeframeRef.current];
          const bucket = Math.floor(payload.timestamp / 1000 / tfSec) * tfSec;
          setCandles((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.time === bucket) {
              const updated: Candle = {
                ...last,
                close: activeInst.price,
                high: Math.max(last.high, activeInst.price),
                low: Math.min(last.low, activeInst.price),
              };
              return [...prev.slice(0, -1), updated];
            }
            return [
              ...prev.slice(-240),
              {
                time: bucket,
                open: last.close,
                high: activeInst.price,
                low: activeInst.price,
                close: activeInst.price,
                volume: 20,
              },
            ];
          });
        }

        // 1. Evaluate Price Alerts
        const currentAlerts = priceAlertsRef.current;
        let alertsChanged = false;
        const nextAlerts = currentAlerts.map((al) => {
          if (!al.active) return al;
          const inst = instMap.get(al.symbol);
          if (!inst) return al;
          const hit =
            (al.condition === 'ABOVE' && inst.price >= al.targetPrice) ||
            (al.condition === 'BELOW' && inst.price <= al.targetPrice);
          if (hit) {
            alertsChanged = true;
            emitNotification(
              `Price Alert: ${al.symbol}`,
              `${al.symbol} crossed ${al.condition === 'ABOVE' ? 'above' : 'below'} ${formatPrice(
                al.targetPrice,
                inst.decimals,
              )} (Last: ${formatPrice(inst.price, inst.decimals)})${
                al.note ? ` · ${al.note}` : ''
              }`,
              'PRICE_ALERT',
              al.symbol,
              'alert',
            );
            return {...al, active: false, triggeredAt: payload.timestamp};
          }
          return al;
        });
        if (alertsChanged) {
          setPriceAlerts(nextAlerts);
        }

        // 1b. Automated ORB & Momentum Notification Engine
        const autoCfg = automationConfigRef.current;
        if (autoCfg.enabled) {
          const nowMs = payload.timestamp;
          const cooldownMs = Math.max(1, autoCfg.cooldownMinutes) * 60_000;

          for (const inst of payload.instruments) {
            if (
              autoCfg.monitoredSymbols.length > 0 &&
              !autoCfg.monitoredSymbols.includes(inst.symbol)
            ) {
              continue;
            }
            const symCandles = candlesBySymbolRef.current[inst.symbol];
            if (!symCandles || symCandles.length < 20) continue;

            // Patch latest close on last candle for real-time evaluation
            const latestBar = symCandles[symCandles.length - 1];
            const patchedCandles = [
              ...symCandles.slice(0, -1),
              {
                ...latestBar,
                close: inst.price,
                high: Math.max(latestBar.high, inst.price),
                low: Math.min(latestBar.low, inst.price),
              },
            ];

            const orb = analyzeORB(inst, patchedCandles, autoCfg.orbWindowMinutes);
            if (!orb) continue;

            const vwapOk =
              !autoCfg.requireVwapConfluence ||
              (orb.bias === 'LONG' && inst.price >= orb.vwap) ||
              (orb.bias === 'SHORT' && inst.price <= orb.vwap);

            const volOk =
              !autoCfg.requireVolumeSurge ||
              orb.volumeRatio >= autoCfg.minVolumeRatio;

            let fireKey: string | null = null;
            let title = '';
            let body = '';
            let chime: 'alert' | 'fill' | 'warning' = 'alert';

            if (
              orb.signal === 'LONG_BREAKOUT' &&
              autoCfg.notifyOnLongBreakout &&
              vwapOk &&
              volOk
            ) {
              fireKey = `${inst.symbol}:LONG_BREAKOUT`;
              title = `ORB Long Signal: ${inst.symbol}`;
              body = `Breakout above ${autoCfg.orbWindowMinutes}m OR High (${formatPrice(
                orb.orHigh,
                inst.decimals,
              )}). Entry ${formatPrice(orb.longPlan.entryPrice, inst.decimals)} · SL ${formatPrice(
                orb.longPlan.stopLoss,
                inst.decimals,
              )} · TP ${formatPrice(orb.longPlan.takeProfit2R, inst.decimals)}`;
              chime = 'fill';
            } else if (
              orb.signal === 'SHORT_BREAKOUT' &&
              autoCfg.notifyOnShortBreakout &&
              vwapOk &&
              volOk
            ) {
              fireKey = `${inst.symbol}:SHORT_BREAKOUT`;
              title = `ORB Short Signal: ${inst.symbol}`;
              body = `Breakdown below ${autoCfg.orbWindowMinutes}m OR Low (${formatPrice(
                orb.orLow,
                inst.decimals,
              )}). Entry ${formatPrice(orb.shortPlan.entryPrice, inst.decimals)} · SL ${formatPrice(
                orb.shortPlan.stopLoss,
                inst.decimals,
              )} · TP ${formatPrice(orb.shortPlan.takeProfit2R, inst.decimals)}`;
              chime = 'warning';
            } else if (
              (orb.signal === 'LONG_RETEST' || orb.signal === 'SHORT_RETEST') &&
              autoCfg.notifyOnRetestSetup &&
              vwapOk
            ) {
              const isLong = orb.signal === 'LONG_RETEST';
              const plan = isLong ? orb.longPlan : orb.shortPlan;
              fireKey = `${inst.symbol}:${orb.signal}`;
              title = `ORB ${isLong ? 'Long' : 'Short'} Retest: ${inst.symbol}`;
              body = `Pullback retest near ${formatPrice(
                isLong ? orb.orHigh : orb.orLow,
                inst.decimals,
              )}. Entry ${formatPrice(plan.entryPrice, inst.decimals)} · SL ${formatPrice(
                plan.stopLoss,
                inst.decimals,
              )}`;
            } else if (
              autoCfg.notifyOnRsiExtremes &&
              (orb.rsi14 >= 72 || orb.rsi14 <= 28)
            ) {
              const overbought = orb.rsi14 >= 72;
              fireKey = `${inst.symbol}:${overbought ? 'RSI_OB' : 'RSI_OS'}`;
              title = `${overbought ? 'Overbought Short Watch' : 'Oversold Long Watch'}: ${
                inst.symbol
              }`;
              body = `RSI(14) reached ${orb.rsi14.toFixed(1)} at ${formatPrice(
                inst.price,
                inst.decimals,
              )}.`;
            }

            if (fireKey) {
              const lastFired = signalCooldownRef.current[fireKey] || 0;
              if (nowMs - lastFired >= cooldownMs) {
                signalCooldownRef.current[fireKey] = nowMs;
                emitNotification(title, body, 'ORB_SIGNAL', inst.symbol, chime);
              }
            }
          }
        }

        // 2. Evaluate Open Positions (Trailing Stop, Stop-Loss, Take-Profit)
        const currentPositions = positionsRef.current;
        if (currentPositions.length > 0) {
          const remaining: Position[] = [];
          const triggeredExecs: TradeExecution[] = [];
          const triggeredBotTrades: XauBotTradeRecord[] = [];
          let cashDelta = 0;
          let modified = false;

          for (const pos of currentPositions) {
            const inst = instMap.get(pos.symbol);
            if (!inst) {
              remaining.push(pos);
              continue;
            }
            const exitMark = pos.side === 'BUY' ? inst.bid : inst.ask;
            let updatedPos = pos;

            // Update Trailing Stop
            if (pos.trailingStopDistance && pos.trailingStopDistance > 0) {
              if (pos.side === 'BUY' && exitMark > pos.peakFavorablePrice) {
                const newSl = Number(
                  (exitMark - pos.trailingStopDistance).toFixed(inst.decimals),
                );
                updatedPos = {
                  ...pos,
                  peakFavorablePrice: exitMark,
                  stopLoss: pos.stopLoss ? Math.max(pos.stopLoss, newSl) : newSl,
                };
                modified = true;
              } else if (pos.side === 'SELL' && exitMark < pos.peakFavorablePrice) {
                const newSl = Number(
                  (exitMark + pos.trailingStopDistance).toFixed(inst.decimals),
                );
                updatedPos = {
                  ...pos,
                  peakFavorablePrice: exitMark,
                  stopLoss: pos.stopLoss ? Math.min(pos.stopLoss, newSl) : newSl,
                };
                modified = true;
              }
            }

            // 2a. Auto Break-Even & 50% Partial Take-Profit for XAU Bot positions
            if (
              updatedPos.source === 'XAU_BOT' &&
              updatedPos.takeProfit !== null
            ) {
              const tpDist = Math.abs(updatedPos.takeProfit - updatedPos.entryPrice);
              const favMove =
                updatedPos.side === 'BUY'
                  ? exitMark - updatedPos.entryPrice
                  : updatedPos.entryPrice - exitMark;

              // Auto Break-Even at 50% progress toward Take-Profit
              if (
                (xauBotConfigRef.current.autoBreakEvenEnabled ?? true) &&
                !updatedPos.breakEvenMoved &&
                tpDist > 0 &&
                favMove >= tpDist * 0.5
              ) {
                const beSl = Number(
                  (updatedPos.side === 'BUY'
                    ? updatedPos.entryPrice + 0.35
                    : updatedPos.entryPrice - 0.35
                  ).toFixed(inst.decimals),
                );
                const tighterSl =
                  updatedPos.side === 'BUY'
                    ? updatedPos.stopLoss !== null
                      ? Math.max(updatedPos.stopLoss, beSl)
                      : beSl
                    : updatedPos.stopLoss !== null
                    ? Math.min(updatedPos.stopLoss, beSl)
                    : beSl;
                updatedPos = {
                  ...updatedPos,
                  stopLoss: tighterSl,
                  breakEvenMoved: true,
                };
                modified = true;
                appendBotLog(
                  'RISK',
                  `Auto Break-Even locked SL @ ${formatPrice(
                    tighterSl,
                    inst.decimals,
                  )} on ${updatedPos.side} XAU/USD (+50% TP reached).`,
                );
              }

              // Partial Take-Profit (close 50% at 70% progress toward TP, keep remainder risk-free)
              if (
                (xauBotConfigRef.current.partialTpEnabled ?? true) &&
                !updatedPos.partialTpTaken &&
                updatedPos.quantity >= 0.04 &&
                tpDist > 0 &&
                favMove >= tpDist * 0.7
              ) {
                const closeQty = Number((updatedPos.quantity * 0.5).toFixed(2));
                const remQty = Number((updatedPos.quantity - closeQty).toFixed(2));
                if (closeQty > 0 && remQty > 0) {
                  const fullPnl = computeUnrealizedPnl(updatedPos, inst);
                  const partialRatio = closeQty / updatedPos.quantity;
                  const partialPnl = Number((fullPnl * partialRatio).toFixed(2));
                  const partialCloseFee = Number(
                    (closeQty * inst.commissionPerUnit).toFixed(2),
                  );
                  const entryFeeShare = Number(
                    ((updatedPos.commissionPaid || 0) * partialRatio).toFixed(2),
                  );
                  const partialNet = Number(
                    (partialPnl - partialCloseFee - entryFeeShare).toFixed(2),
                  );
                  cashDelta += partialPnl - partialCloseFee;

                  triggeredExecs.push({
                    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    symbol: updatedPos.symbol,
                    side: updatedPos.side,
                    action: 'PARTIAL_CLOSE',
                    quantity: closeQty,
                    price: exitMark,
                    realizedPnl: partialPnl,
                    fee: partialCloseFee,
                    timestamp: payload.timestamp,
                    source: 'XAU_BOT',
                    notes: 'XAU Bot Partial TP (50% scale-out @ 70% target)',
                  });
                  triggeredBotTrades.push({
                    id: `btr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    positionId: `${updatedPos.id}-ptp`,
                    symbol: updatedPos.symbol,
                    side: updatedPos.side,
                    strategy: updatedPos.botStrategy || xauBotConfigRef.current.strategy,
                    quantity: closeQty,
                    entryPrice: updatedPos.entryPrice,
                    exitPrice: exitMark,
                    grossPnl: partialPnl,
                    fee: Number((entryFeeShare + partialCloseFee).toFixed(2)),
                    netPnl: partialNet,
                    exitAction: 'PARTIAL_CLOSE',
                    confidenceAtEntry: updatedPos.botConfidence ?? 70,
                    stopLossDollars: xauBotConfigRef.current.stopLossDollars,
                    takeProfitDollars: xauBotConfigRef.current.takeProfitDollars,
                    openedAt: updatedPos.openedAt,
                    closedAt: payload.timestamp,
                  });

                  const beSl = Number(
                    (updatedPos.side === 'BUY'
                      ? updatedPos.entryPrice + 0.35
                      : updatedPos.entryPrice - 0.35
                    ).toFixed(inst.decimals),
                  );
                  const safeSl =
                    updatedPos.side === 'BUY'
                      ? updatedPos.stopLoss !== null
                        ? Math.max(updatedPos.stopLoss, beSl)
                        : beSl
                      : updatedPos.stopLoss !== null
                      ? Math.min(updatedPos.stopLoss, beSl)
                      : beSl;

                  updatedPos = {
                    ...updatedPos,
                    quantity: remQty,
                    marginUsed: Number(
                      (updatedPos.marginUsed * (1 - partialRatio)).toFixed(2),
                    ),
                    commissionPaid: Number(
                      ((updatedPos.commissionPaid || 0) * (1 - partialRatio)).toFixed(2),
                    ),
                    stopLoss: safeSl,
                    breakEvenMoved: true,
                    partialTpTaken: true,
                  };
                  modified = true;

                  appendBotLog(
                    'EXECUTION',
                    `Partial TP booked 50% (${closeQty} lots ${updatedPos.side}) @ ${formatPrice(
                      exitMark,
                      inst.decimals,
                    )} -> +${formatCurrency(partialNet)} net; ${remQty} lots running risk-free.`,
                  );
                  emitNotification(
                    `Partial TP Booked: ${updatedPos.symbol}`,
                    `Closed ${closeQty} ${updatedPos.side} @ ${formatPrice(
                      exitMark,
                      inst.decimals,
                    )} (+${formatCurrency(partialPnl)}) · Runner protected @ BE.`,
                    'TAKE_PROFIT',
                    updatedPos.symbol,
                    'fill',
                  );
                }
              }
            }

            let triggerAction: ExecutionAction | null = null;
            if (updatedPos.stopLoss !== null) {
              const hitSL =
                (updatedPos.side === 'BUY' && exitMark <= updatedPos.stopLoss) ||
                (updatedPos.side === 'SELL' && exitMark >= updatedPos.stopLoss);
              if (hitSL) {
                triggerAction = updatedPos.trailingStopDistance
                  ? 'TRAILING_STOP'
                  : 'STOP_LOSS';
              }
            }

            if (!triggerAction && updatedPos.takeProfit !== null) {
              const hitTP =
                (updatedPos.side === 'BUY' && exitMark >= updatedPos.takeProfit) ||
                (updatedPos.side === 'SELL' && exitMark <= updatedPos.takeProfit);
              if (hitTP) triggerAction = 'TAKE_PROFIT';
            }

            if (
              !triggerAction &&
              updatedPos.source === 'XAU_BOT' &&
              updatedPos.symbol === 'XAU/USD'
            ) {
              const earlyRes = shouldEarlyExitPosition(
                updatedPos,
                exitMark,
                inst.contractSize,
                latestXauEvalRef.current,
                xauBotConfigRef.current.staleTradeMinutes ?? 45,
                payload.timestamp,
              );
              if (earlyRes.exit) {
                triggerAction = 'EARLY_EXIT';
              }
            }

            if (triggerAction) {
              modified = true;
              const pnl = computeUnrealizedPnl(updatedPos, inst);
              const fee = Number((updatedPos.quantity * inst.commissionPerUnit).toFixed(2));
              cashDelta += pnl - fee;

              triggeredExecs.push({
                id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: updatedPos.symbol,
                side: updatedPos.side,
                action: triggerAction,
                quantity: updatedPos.quantity,
                price: exitMark,
                realizedPnl: Number(pnl.toFixed(2)),
                fee,
                timestamp: payload.timestamp,
                source: updatedPos.source,
                notes:
                  updatedPos.source === 'XAU_BOT'
                    ? `XAU Bot ${triggerAction === 'TAKE_PROFIT' ? 'Take-Profit' : 'Stop-Loss'}`
                    : triggerAction === 'TAKE_PROFIT'
                    ? 'Automated Take-Profit fill'
                    : 'Automated Stop-Loss trigger',
              });

              if (updatedPos.source === 'XAU_BOT') {
                const roundTripFee = Number(
                  ((updatedPos.commissionPaid || 0) + fee).toFixed(2),
                );
                const netPnl = Number((pnl - roundTripFee).toFixed(2));
                triggeredBotTrades.push({
                  id: `btr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  positionId: updatedPos.id,
                  symbol: updatedPos.symbol,
                  side: updatedPos.side,
                  strategy: updatedPos.botStrategy || xauBotConfigRef.current.strategy,
                  quantity: updatedPos.quantity,
                  entryPrice: updatedPos.entryPrice,
                  exitPrice: exitMark,
                  grossPnl: Number(pnl.toFixed(2)),
                  fee: roundTripFee,
                  netPnl,
                  exitAction: triggerAction,
                  confidenceAtEntry: updatedPos.botConfidence ?? 70,
                  stopLossDollars: xauBotConfigRef.current.stopLossDollars,
                  takeProfitDollars: xauBotConfigRef.current.takeProfitDollars,
                  openedAt: updatedPos.openedAt,
                  closedAt: payload.timestamp,
                });
                appendBotLog(
                  netPnl >= 0 ? 'EXECUTION' : 'RISK',
                  `Closed ${updatedPos.side} ${updatedPos.quantity} XAU/USD (${triggerAction.replace(
                    '_',
                    ' ',
                  )}) -> ${netPnl >= 0 ? '+' : ''}${formatCurrency(netPnl)} net`,
                );
              }

              emitNotification(
                `${triggerAction === 'TAKE_PROFIT' ? 'Take-Profit Filled' : 'Stop-Loss Triggered'}: ${updatedPos.symbol}`,
                `Closed ${updatedPos.quantity} ${updatedPos.side} @ ${formatPrice(
                  exitMark,
                  inst.decimals,
                )} · Realized ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`,
                triggerAction === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'STOP_LOSS',
                updatedPos.symbol,
                triggerAction === 'TAKE_PROFIT' ? 'fill' : 'warning',
              );
            } else {
              remaining.push(updatedPos);
            }
          }

          if (modified) {
            setPositions(remaining);
          }
          if (triggeredExecs.length > 0) {
            setCashBalance((c) => Number((c + cashDelta).toFixed(2)));
            setExecutions((prev) => [...triggeredExecs, ...prev]);
          }
          if (triggeredBotTrades.length > 0) {
            recordClosedBotTradesAndLearn(triggeredBotTrades);
          }

          // Margin Level Warning Check
          const totalUsed = remaining.reduce((a, p) => a + p.marginUsed, 0);
          if (totalUsed > 0) {
            const totalUnreal = remaining.reduce((acc, p) => {
              const i = instMap.get(p.symbol);
              return acc + (i ? computeUnrealizedPnl(p, i) : 0);
            }, 0);
            const curEq = cashBalanceRef.current + cashDelta + totalUnreal;
            const mLevel = (curEq / totalUsed) * 100;
            if (
              mLevel <= riskSettingsRef.current.marginCallLevelPct &&
              !marginWarnedRef.current
            ) {
              marginWarnedRef.current = true;
              emitNotification(
                'Margin Level Warning',
                `Account margin level dropped to ${mLevel.toFixed(1)}% (threshold ${
                  riskSettingsRef.current.marginCallLevelPct
                }%).`,
                'MARGIN_WARNING',
                undefined,
                'warning',
              );
            } else if (mLevel > riskSettingsRef.current.marginCallLevelPct + 15) {
              marginWarnedRef.current = false;
            }
          }
        }

        // 3. Evaluate Pending Limit / Stop Orders
        const curPending = pendingOrdersRef.current;
        if (curPending.length > 0) {
          const stillPending: PendingOrder[] = [];
          const newPositions: Position[] = [];
          const newExecs: TradeExecution[] = [];
          let feeDelta = 0;

          for (const ord of curPending) {
            const inst = instMap.get(ord.symbol);
            if (!inst) {
              stillPending.push(ord);
              continue;
            }
            const execPrice = ord.side === 'BUY' ? inst.ask : inst.bid;
            const shouldFill =
              (ord.type === 'LIMIT' &&
                ((ord.side === 'BUY' && execPrice <= ord.triggerPrice) ||
                  (ord.side === 'SELL' && execPrice >= ord.triggerPrice))) ||
              (ord.type === 'STOP' &&
                ((ord.side === 'BUY' && execPrice >= ord.triggerPrice) ||
                  (ord.side === 'SELL' && execPrice <= ord.triggerPrice)));

            if (shouldFill) {
              const marginUsed = computeRequiredMargin(
                execPrice,
                ord.quantity,
                ord.leverage,
                inst,
              );
              const fee = Number((ord.quantity * inst.commissionPerUnit).toFixed(2));
              feeDelta += fee;
              newPositions.push({
                id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: ord.symbol,
                side: ord.side,
                quantity: ord.quantity,
                entryPrice: execPrice,
                leverage: ord.leverage,
                marginUsed,
                stopLoss: ord.stopLoss,
                takeProfit: ord.takeProfit,
                trailingStopDistance: null,
                peakFavorablePrice: execPrice,
                openedAt: payload.timestamp,
                commissionPaid: fee,
              });
              newExecs.push({
                id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: ord.symbol,
                side: ord.side,
                action: 'OPEN',
                quantity: ord.quantity,
                price: execPrice,
                realizedPnl: 0,
                fee,
                timestamp: payload.timestamp,
                notes: `${ord.type} order filled`,
              });
              emitNotification(
                `${ord.type} Order Filled: ${ord.symbol}`,
                `${ord.side} ${ord.quantity} @ ${formatPrice(execPrice, inst.decimals)}`,
                'EXECUTION',
                ord.symbol,
                'fill',
              );
            } else {
              stillPending.push(ord);
            }
          }

          if (newPositions.length > 0) {
            setPendingOrders(stillPending);
            setPositions((prev) => [...newPositions, ...prev]);
            setExecutions((prev) => [...newExecs, ...prev]);
            setCashBalance((c) => Number((c - feeDelta).toFixed(2)));
          }
        }

        // 4. Evaluate Autonomous XAU/USD Test Bot on Live Quotes (Browser Mode)
        const botCfg = xauBotConfigRef.current;
        if (
          botCfg.enabled &&
          !server247EnabledRef.current &&
          !securityStateRef.current.isLocked
        ) {
          const xauInst = instMap.get('XAU/USD');
          const rawXauCandles =
            selectedSymbolRef.current === 'XAU/USD' && candlesRef.current.length >= 22
              ? candlesRef.current
              : candlesBySymbolRef.current['XAU/USD'];

          if (xauInst && rawXauCandles && rawXauCandles.length >= 22) {
            const latestBar = rawXauCandles[rawXauCandles.length - 1];
            const patchedXauCandles = [
              ...rawXauCandles.slice(0, -1),
              {
                ...latestBar,
                close: xauInst.price,
                high: Math.max(latestBar.high, xauInst.price),
                low: Math.min(latestBar.low, xauInst.price),
              },
            ];

            const activePositionsNow = positionsRef.current;
            const botOpenPositions = activePositionsNow.filter(
              (p) => p.symbol === 'XAU/USD' && p.source === 'XAU_BOT',
            );
            // Daily loss limit: only today's closed trades count.
            const today = new Date().toDateString();
            const botClosedExecs = executionsRef.current.filter(
              (e) =>
                e.source === 'XAU_BOT' &&
                e.action !== 'OPEN' &&
                new Date(e.timestamp).toDateString() === today,
            );
            const botRealized = botClosedExecs.reduce(
              (acc, e) => acc + e.realizedPnl - e.fee,
              0,
            );
            const botUnreal = botOpenPositions.reduce(
              (acc, p) => acc + computeUnrealizedPnl(p, xauInst),
              0,
            );
            const botNet = botRealized + botUnreal;

            if (botNet <= -Math.abs(botCfg.maxDailyLossDollars)) {
              setXauBotConfig((prev) => ({...prev, enabled: false}));
              appendBotLog(
                'RISK',
                `Bot paused: daily loss limit (-${formatCurrency(
                  botCfg.maxDailyLossDollars,
                )}) reached.`,
              );
              emitNotification(
                'XAU/USD Bot Circuit Breaker',
                `Auto Bot paused at ${formatCurrency(botNet)} net P&L.`,
                'MARGIN_WARNING',
                'XAU/USD',
                'warning',
              );
            } else {
              const nowMs = payload.timestamp;
              const cooldownMs = Math.max(5, botCfg.cooldownSeconds) * 1000;
              const cooldownReady = nowMs - xauBotLastTradeRef.current >= cooldownMs;
              const capacityReady =
                botOpenPositions.length < Math.max(1, botCfg.maxConcurrentPositions);

              const evalRes = evaluateXauBotSignal(
                xauInst,
                patchedXauCandles,
                botCfg,
                automationConfigRef.current.orbWindowMinutes,
                xauPrintsRef.current,
                pendingOrdersRef.current,
                {
                  mtfCandles: xauMtfCandlesRef.current,
                  macro: goldMacroRef.current,
                  institutional: institutionalGoldRef.current,
                  calendar: calendarSnapshotRef.current,
                  closedTrades: xauBotTradesRef.current,
                  accountEquity: cashBalanceRef.current,
                  nowMs,
                },
              );

              if (evalRes) {
                if (
                  (evalRes.action === 'BUY' || evalRes.action === 'SELL') &&
                  capacityReady &&
                  cooldownReady
                ) {
                  const fillPrice =
                    evalRes.action === 'BUY' ? xauInst.ask : xauInst.bid;
                  const multiPlan = evaluateMultiTradeEntry({
                    action: evalRes.action,
                    confidence: evalRes.confidence,
                    entryPrice: fillPrice,
                    baseStopLoss: evalRes.stopLoss,
                    baseTakeProfit: evalRes.takeProfit,
                    atr14: evalRes.orderFlow?.atr14 ?? 2.0,
                    openBotPositions: botOpenPositions,
                    config: botCfg,
                  });

                  if (!multiPlan.allowed) {
                    if (nowMs - xauBotLastHoldLogRef.current >= 25_000) {
                      xauBotLastHoldLogRef.current = nowMs;
                      appendBotLog(
                        'SIGNAL',
                        `${evalRes.action} (${evalRes.confidence}%) deferred: ${multiPlan.reason}`,
                      );
                    }
                  } else {
                    const tradeLot = evalRes.effectiveLotSize || botCfg.lotSize;
                    const usedStrategy = evalRes.selectedSubStrategy || botCfg.strategy;
                    const marginUsed = computeRequiredMargin(
                      fillPrice,
                      tradeLot,
                      botCfg.leverage,
                      xauInst,
                    );
                    const totalUsed = activePositionsNow.reduce(
                      (a, p) => a + p.marginUsed,
                      0,
                    );
                    const totalUnrealAll = activePositionsNow.reduce((a, p) => {
                      const pi = instMap.get(p.symbol);
                      return a + (pi ? computeUnrealizedPnl(p, pi) : 0);
                    }, 0);
                    const estFreeMargin =
                      cashBalanceRef.current + totalUnrealAll - totalUsed;

                    if (marginUsed <= estFreeMargin) {
                      xauBotLastTradeRef.current = nowMs;
                      const fee = Number(
                        (tradeLot * xauInst.commissionPerUnit).toFixed(2),
                      );
                      const tierLabel = multiPlan.isRunner
                        ? `Runner #${multiPlan.tierNumber} (${multiPlan.tpMultiplier}x TP)`
                        : `Core #${multiPlan.tierNumber}`;
                      const newPos: Position = {
                        id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        symbol: 'XAU/USD',
                        side: evalRes.action,
                        quantity: tradeLot,
                        entryPrice: fillPrice,
                        leverage: botCfg.leverage,
                        marginUsed,
                        stopLoss: multiPlan.stopLoss,
                        takeProfit: multiPlan.takeProfit,
                        trailingStopDistance: multiPlan.trailingStopDistance,
                        peakFavorablePrice: fillPrice,
                        openedAt: nowMs,
                        commissionPaid: fee,
                        source: 'XAU_BOT',
                        botStrategy: usedStrategy,
                        botConfidence: evalRes.confidence,
                      };
                      const newExec: TradeExecution = {
                        id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        symbol: 'XAU/USD',
                        side: evalRes.action,
                        action: 'OPEN',
                        quantity: tradeLot,
                        price: fillPrice,
                        realizedPnl: 0,
                        fee,
                        timestamp: nowMs,
                        source: 'XAU_BOT',
                        notes: `XAU Bot ${tierLabel} (${usedStrategy}) · ${evalRes.reason}`,
                      };
                      setPositions((prev) => [newPos, ...prev]);
                      setExecutions((prev) => [newExec, ...prev]);
                      setCashBalance((c) => Number((c - fee).toFixed(2)));
                      appendBotLog(
                        'EXECUTION',
                        `Opened ${tierLabel} ${evalRes.action} ${tradeLot} XAU/USD @ ${formatPrice(
                          fillPrice,
                          2,
                        )} (SL ${formatPrice(multiPlan.stopLoss, 2)} / TP ${formatPrice(
                          multiPlan.takeProfit,
                          2,
                        )}${
                          multiPlan.trailingStopDistance
                            ? ` / Trail $${multiPlan.trailingStopDistance.toFixed(1)}`
                            : ''
                        }) — ${evalRes.reason}`,
                      );
                      emitNotification(
                        `XAU Bot ${tierLabel} ${evalRes.action}`,
                        `${tradeLot} lots XAU/USD @ ${formatPrice(
                          fillPrice,
                          2,
                        )} · SL ${formatPrice(multiPlan.stopLoss, 2)} · TP ${formatPrice(
                          multiPlan.takeProfit,
                          2,
                        )}`,
                        'EXECUTION',
                        'XAU/USD',
                        'fill',
                      );
                    } else {
                      appendBotLog(
                        'RISK',
                        `Skipped ${evalRes.action}: insufficient free margin (${formatCurrency(
                          estFreeMargin,
                        )}).`,
                      );
                    }
                  }
                } else if (nowMs - xauBotLastHoldLogRef.current >= 30_000) {
                  xauBotLastHoldLogRef.current = nowMs;
                  appendBotLog(
                    evalRes.action === 'HOLD' ? 'INFO' : 'SIGNAL',
                    `${evalRes.action} (${evalRes.confidence}%): ${evalRes.reason}`,
                  );
                }
              }
            }
          }
        }
      } catch {
        // Ignore malformed tick
      }
    };

    const startHttpFallback = () => {
      if (cancelled || pollTimer) return;
      const pullOnce = async () => {
        if (cancelled) return;
        try {
          const res = await fetch('/api/markets');
          if (!res.ok) return;
          const data = (await res.json()) as {
            timestamp: number;
            instruments: Instrument[];
          };
          if (!cancelled) processMarketTick(data);
        } catch {
          if (!cancelled) setStreamConnected(false);
        }
      };
      void pullOnce();
      pollTimer = setInterval(pullOnce, 1800);
    };

    const stopHttpFallback = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connectSse = () => {
      if (cancelled) return;
      es?.close();
      es = new EventSource('/api/stream');
      es.onopen = () => {
        consecutiveSseErrors = 0;
        stopHttpFallback();
        if (!cancelled) setStreamConnected(true);
      };
      es.onmessage = (event) => {
        consecutiveSseErrors = 0;
        stopHttpFallback();
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            timestamp: number;
            instruments: Instrument[];
          };
          processMarketTick(payload);
        } catch {
          // Ignore malformed SSE JSON frame
        }
      };
      es.onerror = () => {
        consecutiveSseErrors += 1;
        if (consecutiveSseErrors >= 2) {
          es?.close();
          es = null;
          startHttpFallback();
          if (!retrySseTimer && !cancelled) {
            retrySseTimer = setTimeout(() => {
              retrySseTimer = null;
              consecutiveSseErrors = 0;
              connectSse();
            }, 30_000);
          }
        } else {
          if (!cancelled) setStreamConnected(false);
        }
      };
    };

    connectSse();

    return () => {
      cancelled = true;
      es?.close();
      stopHttpFallback();
      if (retrySseTimer) clearTimeout(retrySseTimer);
      setStreamConnected(false);
    };
  }, [isOnline, emitNotification, appendBotLog, recordClosedBotTradesAndLearn]);

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
  latestXauEvalRef.current = xauBotEvaluation;

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

  // Poll real live Time & Sales prints & liquidity feed for selected symbol (and XAU/USD for the bot)
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const fetchFlow = async () => {
      try {
        const res = await fetch(
          `/api/orderflow/${encodeURIComponent(selectedSymbol)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {recentPrints?: MarketPrint[]};
        if (!cancelled && Array.isArray(data.recentPrints)) {
          setRecentPrints(data.recentPrints);
          if (selectedSymbol === 'XAU/USD') {
            setXauRecentPrints(data.recentPrints);
          }
        }
        if (!cancelled && selectedSymbol !== 'XAU/USD' && xauBotConfigRef.current.enabled) {
          const xauRes = await fetch('/api/orderflow/XAU%2FUSD');
          if (xauRes.ok) {
            const xauData = (await xauRes.json()) as {recentPrints?: MarketPrint[]};
            if (!cancelled && Array.isArray(xauData.recentPrints)) {
              setXauRecentPrints(xauData.recentPrints);
            }
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };
    fetchFlow();
    const timer = setInterval(fetchFlow, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedSymbol, isOnline]);

  // Poll Multi-Timeframe XAU/USD Candles (5m, 15m, 1H) and Macro Gold Context (DXY, US10Y, GC1! Basis)
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const fetchMtf = async () => {
      const tfs: Timeframe[] = ['5m', '15m', '1H', '4H'];
      const results = await Promise.all(
        tfs.map(async (tf) => {
          try {
            const r = await fetch(
              `/api/candles/${encodeURIComponent('XAU/USD')}?timeframe=${tf}`,
            );
            if (!r.ok) return null;
            const d = (await r.json()) as {candles?: Candle[]};
            return d.candles?.length ? ([tf, d.candles] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const patch: Partial<Record<Timeframe, Candle[]>> = {};
      for (const item of results) {
        if (item) patch[item[0]] = item[1];
      }
      if (Object.keys(patch).length > 0) {
        setXauMtfCandles((prev) => ({...prev, ...patch}));
      }
    };

    const fetchMacro = async () => {
      try {
        const res = await fetch('/api/macro/gold');
        if (!res.ok) return;
        const data = (await res.json()) as MacroGoldContext;
        if (!cancelled && typeof data.dxyPrice === 'number') {
          setGoldMacro(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    const fetchInstitutional = async () => {
      try {
        const res = await fetch('/api/institutional/gold');
        if (!res.ok) return;
        const data = (await res.json()) as InstitutionalGoldContext;
        if (!cancelled && typeof data.compositeScore === 'number') {
          setInstitutionalGold(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    const fetchCalendar = async () => {
      try {
        const before = xauBotConfigRef.current.newsPauseMinutesBefore ?? 15;
        const after = xauBotConfigRef.current.newsPauseMinutesAfter ?? 15;
        const res = await fetch(`/api/calendar?before=${before}&after=${after}`);
        if (!res.ok) return;
        const data = (await res.json()) as EconomicCalendarSnapshot;
        if (!cancelled && Array.isArray(data.events)) {
          setCalendarSnapshot(data);
        }
      } catch {
        // Ignore transient errors
      }
    };

    fetchMtf();
    fetchMacro();
    fetchInstitutional();
    fetchCalendar();
    const mtfTimer = setInterval(fetchMtf, 30_000);
    const macroTimer = setInterval(fetchMacro, 8_000);
    const instTimer = setInterval(fetchInstitutional, 8_000);
    const calTimer = setInterval(fetchCalendar, 60_000);

    return () => {
      cancelled = true;
      clearInterval(mtfTimer);
      clearInterval(macroTimer);
      clearInterval(instTimer);
      clearInterval(calTimer);
    };
  }, [isOnline]);

  // Poll 24/7 Server Bot state, back up state locally, and auto-recover if ephemeral Fly disk restarts blank
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const BACKUP_KEY = 'kestrel-server-bot-backup';
    const RESET_KEY = 'kestrel-server-bot-reset-at';

    const pullBotState = async () => {
      try {
        const res = await fetch('/api/bot/state');
        if (!res.ok) return;
        const data = (await res.json()) as ServerBotState;
        if (cancelled) return;
        if (data.machineId) {
          seenMachineIdsRef.current.add(data.machineId);
          if (seenMachineIdsRef.current.size > 1) {
            setMultiMachineDetected(true);
          }
        }
        // Avoid overwriting UI with stale poll response right after user toggled bot/mode
        if (Date.now() - botMutationStampRef.current < 1500) {
          return;
        }

        const serverIsBlank =
          !data.enabled &&
          data.positions.length === 0 &&
          data.closedTrades.length === 0 &&
          data.executions.length === 0 &&
          data.lastEvaluatedAt === 0;

        if (
          serverIsBlank &&
          seenMachineIdsRef.current.size <= 1 &&
          data.bootId &&
          !restoredBootIdsRef.current.has(data.bootId)
        ) {
          restoredBootIdsRef.current.add(data.bootId);
          try {
            const rawBackup = localStorage.getItem(BACKUP_KEY);
            const resetAt = Number(localStorage.getItem(RESET_KEY) || '0');
            if (rawBackup) {
              const parsed = JSON.parse(rawBackup) as {
                savedAt: number;
                state: ServerBotState;
              };
              const st = parsed?.state;
              const hasActivity = Boolean(
                st &&
                  (st.enabled ||
                    st.positions.length > 0 ||
                    st.closedTrades.length > 0 ||
                    st.executions.length > 0),
              );
              if (hasActivity && parsed.savedAt > resetAt) {
                botMutationStampRef.current = Date.now();
                const restoreRes = await fetch('/api/bot/restore', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify(st),
                });
                if (restoreRes.ok && !cancelled) {
                  const restored = (await restoreRes.json()) as ServerBotState;
                  botMutationStampRef.current = Date.now();
                  setServerBotState(restored);
                  if (restored.brokerStatus) {
                    setBrokerStatus(restored.brokerStatus);
                  }
                  if (restored.enabled && !userChoseBrowserModeRef.current) {
                    setServer247Enabled(true);
                  }
                  emitNotification(
                    '24/7 Bot Auto-Restored',
                    `Server restarted — restored ${restored.positions.length} open & ${restored.closedTrades.length} closed trades automatically.`,
                    'SYSTEM',
                  );
                  return;
                }
              }
            }
          } catch {
            // Ignore malformed backup
          }
        }

        setServerBotState(data);
        if (data.brokerStatus) {
          setBrokerStatus(data.brokerStatus);
        }
        if (data.enabled && !userChoseBrowserModeRef.current) {
          setServer247Enabled(true);
        }

        if (
          data.enabled ||
          data.positions.length > 0 ||
          data.closedTrades.length > 0 ||
          data.executions.length > 0
        ) {
          try {
            localStorage.setItem(
              BACKUP_KEY,
              JSON.stringify({savedAt: Date.now(), state: data}),
            );
          } catch {
            // Ignore quota errors
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };
    pullBotState();
    const timer = setInterval(pullBotState, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOnline, emitNotification]);

  // Acquire Browser Screen Wake Lock while Browser Bot runs so device doesn't sleep
  useEffect(() => {
    const shouldLock = xauBotConfig.enabled && !server247Enabled;
    if (!shouldLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockActive(false);
      return;
    }
    let sentinel: {release: () => Promise<void>} | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const wl = await (
          navigator as Navigator & {
            wakeLock?: {request: (t: 'screen') => Promise<{release: () => Promise<void>}>};
          }
        ).wakeLock?.request('screen');
        if (!cancelled && wl) {
          sentinel = wl;
          setWakeLockActive(true);
        }
      } catch {
        if (!cancelled) setWakeLockActive(false);
      }
    };

    acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      sentinel?.release().catch(() => {});
      setWakeLockActive(false);
    };
  }, [xauBotConfig.enabled, server247Enabled]);

  const syncConfigToBot = useCallback(
    async (next: XauBotConfig) => {
      if (server247EnabledRef.current) {
        // Keep browser loop disabled while 24/7 server worker owns execution
        setXauBotConfig({...next, enabled: false});
        if (!isOnline) return;
        botMutationStampRef.current = Date.now();
        try {
          const res = await fetch('/api/bot/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(next),
          });
          if (res.ok) {
            const data = (await res.json()) as ServerBotState;
            botMutationStampRef.current = Date.now();
            setServerBotState(data);
          }
        } catch {
          // Ignore transient error
        }
        return;
      }
      setXauBotConfig(next);
    },
    [isOnline],
  );

  const handleToggleServer247 = useCallback(async () => {
    const nextMode = !server247EnabledRef.current;
    botMutationStampRef.current = Date.now();
    userChoseBrowserModeRef.current = !nextMode;
    setServer247Enabled(nextMode);
    if (nextMode) {
      // Hand off to 24/7 backend worker and pause local browser loop
      const payload = {...xauBotConfigRef.current, enabled: true};
      setXauBotConfig((prev) => ({...prev, enabled: false}));
      try {
        const res = await fetch('/api/bot/config', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = (await res.json()) as ServerBotState;
          botMutationStampRef.current = Date.now();
          setServerBotState(data);
        }
      } catch {
        // Ignore
      }
      appendBotLog(
        'INFO',
        'Switched to 24/7 Server Worker mode (runs in Node.js backend even if browser closes).',
      );
    } else {
      setXauBotConfig((prev) => ({...prev, enabled: false}));
      try {
        const res = await fetch('/api/bot/config', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({enabled: false}),
        });
        if (res.ok) {
          const data = (await res.json()) as ServerBotState;
          botMutationStampRef.current = Date.now();
          setServerBotState(data);
        }
      } catch {
        // Ignore
      }
      appendBotLog('INFO', 'Switched back to Browser Bot mode.');
    }
  }, [appendBotLog]);

  const orderFlowSnapshot = useMemo(() => {
    if (!selectedInstrument || candles.length < 20) return null;
    return analyzeOrderFlow(
      selectedInstrument,
      candles,
      recentPrints,
      pendingOrders,
      selectedInstrument.symbol === 'XAU/USD' || selectedInstrument.symbol === 'GC1!'
        ? institutionalGold
        : null,
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

  // Order Execution Core
  const executeOrderInternal = useCallback(
    (payload: PendingOrderPayload) => {
      const inst = instrumentsMap.get(payload.symbol);
      if (!inst) return;

      if (payload.type === 'MARKET') {
        const fillPrice = payload.side === 'BUY' ? inst.ask : inst.bid;
        const marginUsed = computeRequiredMargin(
          fillPrice,
          payload.quantity,
          payload.leverage,
          inst,
        );
        const fee = Number((payload.quantity * inst.commissionPerUnit).toFixed(2));
        const newPos: Position = {
          id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: payload.symbol,
          side: payload.side,
          quantity: payload.quantity,
          entryPrice: fillPrice,
          leverage: payload.leverage,
          marginUsed,
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          trailingStopDistance: payload.trailingStopDistance,
          peakFavorablePrice: fillPrice,
          openedAt: Date.now(),
          commissionPaid: fee,
          source: payload.source,
          botStrategy: payload.botStrategy,
          botConfidence: payload.botConfidence,
        };
        const exec: TradeExecution = {
          id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: payload.symbol,
          side: payload.side,
          action: 'OPEN',
          quantity: payload.quantity,
          price: fillPrice,
          realizedPnl: 0,
          fee,
          timestamp: Date.now(),
          source: payload.source,
          notes:
            payload.note ||
            (payload.source === 'XAU_BOT'
              ? 'XAU/USD Auto Bot execution'
              : 'Instant market fill'),
        };
        setPositions((prev) => [newPos, ...prev]);
        setExecutions((prev) => [exec, ...prev]);
        setCashBalance((c) => Number((c - fee).toFixed(2)));
        emitNotification(
          `${payload.source === 'XAU_BOT' ? 'XAU Bot ' : 'Executed '}${payload.side} ${
            payload.symbol
          }`,
          `Filled ${payload.quantity} ${inst.unitLabel} @ ${formatPrice(
            fillPrice,
            inst.decimals,
          )}`,
          'EXECUTION',
          payload.symbol,
          'fill',
        );
      } else {
        const ord: PendingOrder = {
          id: `ord-${Date.now()}`,
          symbol: payload.symbol,
          side: payload.side,
          type: payload.type,
          quantity: payload.quantity,
          triggerPrice: payload.triggerPrice || inst.price,
          leverage: payload.leverage,
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          createdAt: Date.now(),
        };
        setPendingOrders((prev) => [ord, ...prev]);
        emitNotification(
          `${payload.type} Order Placed: ${payload.symbol}`,
          `${payload.side} ${payload.quantity} @ ${formatPrice(
            ord.triggerPrice,
            inst.decimals,
          )}`,
          'EXECUTION',
          payload.symbol,
          'alert',
        );
      }
    },
    [instrumentsMap, emitNotification],
  );

  const handleSubmitOrder = (payload: PendingOrderPayload) => {
    if (
      riskSettings.requireBiometricForOrders &&
      (securityState.biometricEnrolled || securityState.pinConfigured)
    ) {
      setPendingBiometricOrder(payload);
      return;
    }
    executeOrderInternal(payload);
  };

  const handleQuickTrade = (side: OrderSide) => {
    if (!selectedInstrument || !isOnline) return;
    const qty = selectedInstrument.contractType === 'FUTURE' ? 1 : 0.25;
    const lev = Math.min(10, selectedInstrument.maxLeverage);
    const slDist = selectedInstrument.price * 0.008;
    const tpDist = selectedInstrument.price * 0.016;
    const factor = Math.pow(10, selectedInstrument.decimals);
    const sl =
      Math.round(
        (side === 'BUY'
          ? selectedInstrument.price - slDist
          : selectedInstrument.price + slDist) * factor,
      ) / factor;
    const tp =
      Math.round(
        (side === 'BUY'
          ? selectedInstrument.price + tpDist
          : selectedInstrument.price - tpDist) * factor,
      ) / factor;

    handleSubmitOrder({
      symbol: selectedInstrument.symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      leverage: lev,
      stopLoss: sl,
      takeProfit: tp,
      trailingStopDistance: null,
    });
  };

  const handleClosePosition = async (positionId: string, fraction = 1) => {
    const serverPos = serverBotState?.positions.find((p) => p.id === positionId);
    if (serverPos || positionId.startsWith('sbpos-')) {
      try {
        const res = await fetch(`/api/bot/close/${encodeURIComponent(positionId)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({fraction}),
        });
        if (res.ok) {
          const updated = (await res.json()) as ServerBotState;
          setServerBotState(updated);
          if (serverPos) {
            emitNotification(
              `Closed ${serverPos.symbol}`,
              `24/7 Bot ${serverPos.side} ${fraction >= 1 ? serverPos.quantity : '50%'} closed`,
              'EXECUTION',
              serverPos.symbol,
              'fill',
            );
          }
        }
      } catch {
        // Ignore transient network errors
      }
      return;
    }

    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;
    const inst = instrumentsMap.get(pos.symbol);
    if (!inst) return;

    const closeQty =
      fraction >= 1
        ? pos.quantity
        : inst.contractType === 'FUTURE'
        ? Math.max(1, Math.floor(pos.quantity * fraction))
        : Number((pos.quantity * fraction).toFixed(2));

    const actualFraction = Math.min(1, closeQty / pos.quantity);
    const fullPnl = computeUnrealizedPnl(pos, inst);
    const realizedPnl = Number((fullPnl * actualFraction).toFixed(2));
    const exitPrice = pos.side === 'BUY' ? inst.bid : inst.ask;
    const fee = Number((closeQty * inst.commissionPerUnit).toFixed(2));

    if (actualFraction >= 0.999) {
      setPositions((prev) => prev.filter((p) => p.id !== positionId));
    } else {
      setPositions((prev) =>
        prev.map((p) =>
          p.id === positionId
            ? {
                ...p,
                quantity: Number((p.quantity - closeQty).toFixed(4)),
                marginUsed: p.marginUsed * (1 - actualFraction),
              }
            : p,
        ),
      );
    }

    setCashBalance((c) => Number((c + realizedPnl - fee).toFixed(2)));
    const closedAt = Date.now();
    const exitAction: ExecutionAction =
      actualFraction >= 0.999 ? 'CLOSE' : 'PARTIAL_CLOSE';

    setExecutions((prev) => [
      {
        id: `exec-${closedAt}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: pos.symbol,
        side: pos.side,
        action: exitAction,
        quantity: closeQty,
        price: exitPrice,
        realizedPnl,
        fee,
        timestamp: closedAt,
        source: pos.source,
        notes: actualFraction >= 0.999 ? 'Manual full close' : 'Partial close',
      },
      ...prev,
    ]);

    if (pos.source === 'XAU_BOT') {
      const roundTripFee = Number(
        ((pos.commissionPaid || 0) * actualFraction + fee).toFixed(2),
      );
      const netPnl = Number((realizedPnl - roundTripFee).toFixed(2));
      const record: XauBotTradeRecord = {
        id: `btr-${closedAt}-${Math.random().toString(36).slice(2, 6)}`,
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        strategy: pos.botStrategy || xauBotConfig.strategy,
        quantity: closeQty,
        entryPrice: pos.entryPrice,
        exitPrice,
        grossPnl: realizedPnl,
        fee: roundTripFee,
        netPnl,
        exitAction,
        confidenceAtEntry: pos.botConfidence ?? 70,
        stopLossDollars: xauBotConfig.stopLossDollars,
        takeProfitDollars: xauBotConfig.takeProfitDollars,
        openedAt: pos.openedAt,
        closedAt,
      };
      recordClosedBotTradesAndLearn([record]);
      appendBotLog(
        netPnl >= 0 ? 'EXECUTION' : 'RISK',
        `Closed ${pos.side} ${closeQty} XAU/USD (Manual) -> ${
          netPnl >= 0 ? '+' : ''
        }${formatCurrency(netPnl)} net`,
      );
    }

    emitNotification(
      `Closed ${pos.symbol}`,
      `${closeQty} ${pos.side} @ ${formatPrice(exitPrice, inst.decimals)} · P&L ${
        realizedPnl >= 0 ? '+' : ''
      }${formatCurrency(realizedPnl)}`,
      'EXECUTION',
      pos.symbol,
      'fill',
    );
  };

  const handleFlattenAll = async () => {
    positions.forEach((p) => void handleClosePosition(p.id, 1));
    if ((serverBotState?.positions.length ?? 0) > 0) {
      try {
        const res = await fetch('/api/bot/close-all', {method: 'POST'});
        if (res.ok) {
          setServerBotState((await res.json()) as ServerBotState);
        }
      } catch {
        // Ignore transient network errors
      }
    }
  };

  const handleUpdatePositionRisk = async (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => {
    if (
      serverBotState?.positions.some((p) => p.id === positionId) ||
      positionId.startsWith('sbpos-')
    ) {
      try {
        const res = await fetch(`/api/bot/risk/${encodeURIComponent(positionId)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({stopLoss, takeProfit}),
        });
        if (res.ok) {
          setServerBotState((await res.json()) as ServerBotState);
        }
      } catch {
        // Ignore transient network errors
      }
      return;
    }
    setPositions((prev) =>
      prev.map((p) =>
        p.id === positionId ? {...p, stopLoss, takeProfit} : p,
      ),
    );
  };

  const handleGenerateTodayReport = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(todayStr + 'T00:00:00').getTime();
    const todayExecs = executions.filter((e) => e.timestamp >= todayStart);
    const closedExecs = todayExecs.filter((e) => e.action !== 'OPEN');
    const realizedPnl = closedExecs.reduce((a, e) => a + e.realizedPnl, 0);
    const commissions = -todayExecs.reduce((a, e) => a + e.fee, 0);
    const swapFees = positions.reduce((acc, p) => {
      const inst = instrumentsMap.get(p.symbol);
      if (!inst) return acc;
      return (
        acc +
        (p.side === 'BUY' ? inst.overnightSwapLong : inst.overnightSwapShort) *
          p.quantity
      );
    }, 0);
    const netPnl = Number((equity - dayStartEquity + swapFees).toFixed(2));
    const wins = closedExecs.filter((e) => e.realizedPnl > 0).length;
    const losses = closedExecs.filter((e) => e.realizedPnl < 0).length;
    const tradesCount = Math.max(todayExecs.length, 1);

    const assetBreakdown: Record<string, number> = {};
    closedExecs.forEach((e) => {
      const cls = instrumentsMap.get(e.symbol)?.assetClass || 'FUTURES';
      assetBreakdown[cls] = (assetBreakdown[cls] || 0) + e.realizedPnl;
    });

    const newReport: EODReport = {
      id: `eod-${todayStr}`,
      date: todayStr,
      startingEquity: Number(dayStartEquity.toFixed(2)),
      endingEquity: Number((equity + swapFees).toFixed(2)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      swapFees: Number(swapFees.toFixed(2)),
      commissions: Number(commissions.toFixed(2)),
      netPnl,
      returnPct:
        dayStartEquity > 0
          ? Number(((netPnl / dayStartEquity) * 100).toFixed(2))
          : 0,
      tradesCount,
      winCount: wins,
      lossCount: losses,
      winRate:
        wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 100,
      profitFactor: losses === 0 ? 2.4 : 1.35,
      maxDrawdownPct: netPnl < 0 ? Number(Math.abs((netPnl / dayStartEquity) * 100).toFixed(2)) : 0.35,
      peakMarginUsed: Math.round(usedMargin),
      assetBreakdown,
      settledAt: Date.now(),
    };

    setEodReports((prev) => [
      newReport,
      ...prev.filter((r) => r.date !== todayStr),
    ]);
    emitNotification(
      `EOD Settlement Closed (${todayStr})`,
      `Net P&L: ${netPnl >= 0 ? '+' : ''}${formatCurrency(netPnl)} · Ending Equity: ${formatCurrency(
        newReport.endingEquity,
      )}`,
      'SYSTEM',
    );
  };

  const handleSyncBroker = async () => {
    try {
      const res = await fetch('/api/broker/sync', {method: 'POST'});
      if (res.ok) {
        setBrokerStatus((await res.json()) as BrokerStatus);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  const handleToggleBrokerRouting = async (armed: boolean) => {
    try {
      const res = await fetch('/api/broker/mode', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({routingArmed: armed}),
      });
      if (res.ok) {
        const nextStatus = (await res.json()) as BrokerStatus;
        setBrokerStatus(nextStatus);
        emitNotification(
          armed ? `Broker Routing ARMED (${nextStatus.provider})` : 'Broker Routing DISARMED',
          armed
            ? `24/7 XAU Bot orders now route to ${nextStatus.accountLabel}.`
            : 'Switched safely back to Paper Simulation ledger.',
          'SYSTEM',
        );
      }
    } catch {
      // Ignore transient network errors
    }
  };

  const handleResetCleanAccount = async (startingBalance = 10000) => {
    const clean = createCleanAccountState(startingBalance);
    setCashBalance(clean.cashBalance);
    setDayStartEquity(clean.dayStartEquity);
    setPositions([]);
    setPendingOrders([]);
    setExecutions([]);
    setEodReports([]);
    setXauBotTrades([]);
    setXauBotLogs([]);
    setXauBotAdaptations([]);
    setNotifications([]);
    setXauBotConfig((prev) => ({...prev, enabled: false}));
    setServer247Enabled(false);

    try {
      localStorage.removeItem('kestrel-server-bot-backup');
      localStorage.setItem('kestrel-server-bot-reset-at', String(Date.now()));
    } catch {
      // Ignore storage error
    }

    try {
      const res = await fetch('/api/bot/reset', {method: 'POST'});
      if (res.ok) {
        const nextServer = (await res.json()) as ServerBotState;
        setServerBotState(nextServer);
        if (nextServer.brokerStatus) {
          setBrokerStatus(nextServer.brokerStatus);
        }
      }
    } catch {
      // Ignore offline reset
    }

    await saveWorkspace({
      cashBalance: clean.cashBalance,
      dayStartEquity: clean.dayStartEquity,
      positions: [],
      pendingOrders: [],
      executions: [],
      priceAlerts,
      notifications: [],
      eodReports: [],
      riskSettings,
      securityState,
      automationConfig,
      xauBotConfig: {...xauBotConfig, enabled: false},
      xauBotLogs: [],
      xauBotTrades: [],
      xauBotAdaptations: [],
      drawings,
      cachedInstruments: instruments,
      lastSyncedAt: Date.now(),
    });

    emitNotification(
      'Account Reset to Clean Baseline',
      `Starting equity ${formatCurrency(clean.cashBalance)} with $0.00 historical P&L.`,
      'SYSTEM',
    );
  };

  const handleLockClick = () => {
    if (!securityState.biometricEnrolled && !securityState.pinConfigured) {
      setActiveTab('security');
      return;
    }
    setSecurityState((s) => ({...s, isLocked: !s.isLocked}));
  };

  const unreadAlerts = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 pb-18 lg:pb-6">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unreadAlerts={unreadAlerts}
        isLocked={securityState.isLocked}
        onLockSession={handleLockClick}
        biometricConfigured={
          securityState.biometricEnrolled || securityState.pinConfigured
        }
      />

      {/* Workspace Telemetry & Account Strip (Clean below-header bar) */}
      <div className="border-b border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#0E131B]">
        <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 lg:gap-6 font-mono tabular-nums">
            <div>
              <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
                Equity
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {formatCurrency(equity)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
                Day P&L
              </span>
              <span
                className={`font-semibold ${
                  dailyPnl >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {dailyPnl >= 0 ? '+' : ''}
                {formatCurrency(dailyPnl)}
              </span>
            </div>
            <div className="hidden sm:block">
              <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
                Free Margin
              </span>
              <span className="text-slate-800 dark:text-slate-200">
                {formatCurrency(freeMargin)}
              </span>
            </div>
            <div className="hidden md:block">
              <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
                Margin Level
              </span>
              <span className="text-slate-800 dark:text-slate-200">
                {usedMargin === 0 ? '∞' : `${marginLevelPct.toFixed(0)}%`}
              </span>
            </div>
          </div>

          {/* Right Workspace Utility Controls */}
          <div className="flex items-center gap-2">
            {/* Real SSE Live Stream / Offline Cache Toggle */}
            <button
              type="button"
              onClick={() => setSimulatedOffline((v) => !v)}
              title="Toggle offline mode to verify cached portfolio access"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#242E42] px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#192130] transition-colors whitespace-nowrap cursor-pointer"
            >
              {isOnline && streamConnected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Live Feed</span>
                </>
              ) : isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-blue-500" />
                  <span>Connecting</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                  <span>Offline Cache</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              aria-label="Toggle Light/Dark theme"
              className="p-1.5 rounded-md border border-slate-200 dark:border-[#242E42] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#192130] transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <PWAInstallButton compact />
          </div>
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1 mx-auto w-full max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4">
        {activeTab === 'trade' && (
          <div className="space-y-4">
            {/* Mobile Sub-switcher within Trade view */}
            <div className="lg:hidden grid grid-cols-3 gap-1 p-1 rounded-xl bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636]">
              {(
                [
                  {id: 'CHART', label: 'Chart'},
                  {id: 'MARKETS', label: 'Markets'},
                  {id: 'ORDER', label: 'Order Ticket'},
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMobileTradePanel(t.id)}
                  className={`py-2 text-xs font-medium rounded-lg min-h-[40px] cursor-pointer ${
                    mobileTradePanel === t.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {selectedInstrument ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left Watchlist */}
                <div
                  className={`lg:col-span-3 lg:h-[640px] ${
                    mobileTradePanel === 'MARKETS' ? 'block' : 'hidden lg:block'
                  }`}
                >
                  <MarketWatchlist
                    instruments={instruments}
                    selectedSymbol={selectedInstrument.symbol}
                    onSelectSymbol={(sym) => {
                      setSelectedSymbol(sym);
                      setMobileTradePanel('CHART');
                    }}
                  />
                </div>

                {/* Center Chart + ORB Long/Short Analyzer */}
                <div
                  className={`lg:col-span-6 space-y-4 ${
                    mobileTradePanel === 'CHART' ? 'block' : 'hidden lg:block'
                  }`}
                >
                  <AdvancedChart
                    instrument={selectedInstrument}
                    candles={candles}
                    timeframe={timeframe}
                    onChangeTimeframe={setTimeframe}
                    positions={allPositions}
                    alerts={priceAlerts}
                    orbAnalysis={activeOrbAnalysis}
                    drawings={drawings}
                    onAddDrawing={(d) => setDrawings((prev) => [...prev, d])}
                    onClearDrawings={(sym) =>
                      setDrawings((prev) => prev.filter((d) => d.symbol !== sym))
                    }
                    onQuickTrade={handleQuickTrade}
                    isOnline={isOnline}
                    isDark={isDark}
                  />

                  {/* Center Strategy / Bot Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-1">
                      <button
                        type="button"
                        onClick={() => setCenterSubTab('XAU_BOT')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                          centerSubTab === 'XAU_BOT'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        XAU/USD Auto Bot
                        {activeBotConfig.enabled ? ' · Active' : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCenterSubTab('ORDER_FLOW')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                          centerSubTab === 'ORDER_FLOW'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        Order Flow &amp; Liquidity
                      </button>
                      <button
                        type="button"
                        onClick={() => setCenterSubTab('ORB')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                          centerSubTab === 'ORB'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        ORB Analyzer
                      </button>
                      <button
                        type="button"
                        onClick={() => setCenterSubTab('CALENDAR')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                          centerSubTab === 'CALENDAR'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        Economic Calendar
                        {calendarSnapshot?.newsGuardActive ? ' · Guard' : ''}
                      </button>
                    </div>
                    {selectedSymbol !== 'XAU/USD' && centerSubTab === 'XAU_BOT' && (
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol('XAU/USD')}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Switch chart to XAU/USD
                      </button>
                    )}
                  </div>

                  {centerSubTab === 'XAU_BOT' ? (
                    <XauAutoBotPanel
                      xauInstrument={xauInstrument}
                      config={activeBotConfig}
                      evaluation={xauBotEvaluation}
                      botPositions={botPositions}
                      botExecutions={botExecutions}
                      logs={activeBotLogs}
                      isOnline={isOnline}
                      server247Enabled={server247Enabled}
                      wakeLockActive={wakeLockActive}
                      multiMachineDetected={multiMachineDetected}
                      onToggleServer247={handleToggleServer247}
                      onOpenCalendar={() => setCenterSubTab('CALENDAR')}
                      onUpdateConfig={syncConfigToBot}
                      onToggleBot={async () => {
                        const next = !activeBotConfig.enabled;
                        await syncConfigToBot({...activeBotConfig, enabled: next});
                        appendBotLog(
                          'INFO',
                          next
                            ? `Auto Bot STARTED on live XAU/USD quotes (${activeBotConfig.strategy}, ${activeBotConfig.lotSize} lots).`
                            : 'Auto Bot PAUSED by trader.',
                        );
                        if (next && selectedSymbol !== 'XAU/USD') {
                          setSelectedSymbol('XAU/USD');
                        }
                      }}
                      onEvaluateNow={() => {
                        if (!xauInstrument || !xauBotEvaluation) {
                          appendBotLog(
                            'INFO',
                            'Waiting for at least 22 live XAU/USD candles to evaluate.',
                          );
                          return;
                        }
                        appendBotLog(
                          xauBotEvaluation.action === 'HOLD' ? 'INFO' : 'SIGNAL',
                          `Manual scan -> ${xauBotEvaluation.action} (${xauBotEvaluation.confidence}%): ${xauBotEvaluation.reason}`,
                        );
                        if (
                          (xauBotEvaluation.action === 'BUY' ||
                            xauBotEvaluation.action === 'SELL') &&
                          botPositions.length < Math.max(1, xauBotConfig.maxConcurrentPositions)
                        ) {
                          const entryRef =
                            xauBotEvaluation.action === 'BUY'
                              ? xauInstrument.ask
                              : xauInstrument.bid;
                          const multiPlan = evaluateMultiTradeEntry({
                            action: xauBotEvaluation.action,
                            confidence: xauBotEvaluation.confidence,
                            entryPrice: entryRef,
                            baseStopLoss: xauBotEvaluation.stopLoss,
                            baseTakeProfit: xauBotEvaluation.takeProfit,
                            atr14: xauBotEvaluation.orderFlow?.atr14 ?? 2.0,
                            openBotPositions: botPositions,
                            config: xauBotConfig,
                            ignoreSpacing: true,
                          });
                          if (multiPlan.allowed) {
                            const tierLabel = multiPlan.isRunner
                              ? `Runner #${multiPlan.tierNumber} (${multiPlan.tpMultiplier}x TP)`
                              : `Core #${multiPlan.tierNumber}`;
                            xauBotLastTradeRef.current = Date.now();
                            executeOrderInternal({
                              symbol: 'XAU/USD',
                              side: xauBotEvaluation.action,
                              type: 'MARKET',
                              quantity: xauBotConfig.lotSize,
                              leverage: xauBotConfig.leverage,
                              stopLoss: multiPlan.stopLoss,
                              takeProfit: multiPlan.takeProfit,
                              trailingStopDistance: multiPlan.trailingStopDistance,
                              source: 'XAU_BOT',
                              botStrategy: xauBotConfig.strategy,
                              botConfidence: xauBotEvaluation.confidence,
                              note: `XAU Bot manual ${tierLabel} (${xauBotConfig.strategy})`,
                            });
                            appendBotLog(
                              'EXECUTION',
                              `Manual scan executed ${tierLabel} ${xauBotEvaluation.action} ${xauBotConfig.lotSize} XAU/USD (TP ${formatPrice(multiPlan.takeProfit, 2)}).`,
                            );
                          }
                        }
                      }}
                      onRunSamplePaperTrade={(side) => {
                        if (!xauInstrument) return;
                        const entryRef =
                          side === 'BUY' ? xauInstrument.ask : xauInstrument.bid;
                        const baseSl = Number(
                          (side === 'BUY'
                            ? entryRef - xauBotConfig.stopLossDollars
                            : entryRef + xauBotConfig.stopLossDollars
                          ).toFixed(2),
                        );
                        const sameSideCount = botPositions.filter(
                          (p) => p.side === side,
                        ).length;
                        const tpMultiplier = Number(
                          (1 + sameSideCount * 0.35).toFixed(2),
                        );
                        const scaledTpDist = Number(
                          (xauBotConfig.takeProfitDollars * tpMultiplier).toFixed(2),
                        );
                        const tp = Number(
                          (side === 'BUY'
                            ? entryRef + scaledTpDist
                            : entryRef - scaledTpDist
                          ).toFixed(2),
                        );
                        const runnerTrail =
                          sameSideCount > 0
                            ? xauBotConfig.trailingStopDollars ??
                              Math.max(
                                4.5,
                                Number(
                                  (xauBotConfig.stopLossDollars * 0.75).toFixed(2),
                                ),
                              )
                            : xauBotConfig.trailingStopDollars;
                        const tierLabel =
                          sameSideCount > 0
                            ? `Runner #${sameSideCount + 1} (${tpMultiplier}x TP)`
                            : 'Core #1';
                        xauBotLastTradeRef.current = Date.now();
                        executeOrderInternal({
                          symbol: 'XAU/USD',
                          side,
                          type: 'MARKET',
                          quantity: xauBotConfig.lotSize,
                          leverage: xauBotConfig.leverage,
                          stopLoss: baseSl,
                          takeProfit: tp,
                          trailingStopDistance: runnerTrail,
                          source: 'XAU_BOT',
                          botStrategy: xauBotConfig.strategy,
                          botConfidence: xauBotEvaluation?.confidence ?? 75,
                          note: `XAU Bot live paper test ${tierLabel} (${side})`,
                        });
                        appendBotLog(
                          'EXECUTION',
                          `Test Bot ${tierLabel} ${side} ${xauBotConfig.lotSize} XAU/USD @ ${formatPrice(
                            entryRef,
                            2,
                          )} (SL ${formatPrice(baseSl, 2)} / TP ${formatPrice(tp, 2)})`,
                        );
                      }}
                      onCloseBotPositions={async () => {
                        if (server247Enabled) {
                          try {
                            const res = await fetch('/api/bot/close-all', {method: 'POST'});
                            if (res.ok) {
                              setServerBotState((await res.json()) as ServerBotState);
                            }
                          } catch {
                            // Ignore
                          }
                        } else {
                          botPositions.forEach((p) => handleClosePosition(p.id, 1));
                          appendBotLog(
                            'INFO',
                            `Closed ${botPositions.length} active XAU/USD bot position(s).`,
                          );
                        }
                      }}
                      onClearLogs={() => setXauBotLogs([])}
                      onOpenStats={() => setActiveTab('bot')}
                      brokerStatus={brokerStatus}
                      onOpenBrokerSettings={() => setActiveTab('portfolio')}
                    />
                  ) : centerSubTab === 'CALENDAR' ? (
                    <EconomicCalendarPanel
                      calendar={calendarSnapshot}
                      newsGuardEnabled={activeBotConfig.useNewsGuard ?? true}
                      pauseMinutesBefore={activeBotConfig.newsPauseMinutesBefore ?? 15}
                      pauseMinutesAfter={activeBotConfig.newsPauseMinutesAfter ?? 15}
                      onToggleNewsGuard={() =>
                        syncConfigToBot({
                          ...activeBotConfig,
                          useNewsGuard: !(activeBotConfig.useNewsGuard ?? true),
                        })
                      }
                      onRefresh={async () => {
                        try {
                          const res = await fetch('/api/calendar');
                          if (res.ok) {
                            setCalendarSnapshot(
                              (await res.json()) as EconomicCalendarSnapshot,
                            );
                          }
                        } catch {
                          // Ignore
                        }
                      }}
                    />
                  ) : centerSubTab === 'ORDER_FLOW' ? (
                    <OrderFlowPanel
                      instrument={selectedInstrument}
                      snapshot={orderFlowSnapshot}
                      institutional={
                        selectedInstrument.symbol === 'XAU/USD' ||
                        selectedInstrument.symbol === 'GC1!'
                          ? institutionalGold
                          : null
                      }
                      onStageOrder={(preset) => {
                        setStagedOrderPreset(preset);
                        setMobileTradePanel('ORDER');
                      }}
                    />
                  ) : (
                    <ORBAnalysisPanel
                      instrument={selectedInstrument}
                      analysis={activeOrbAnalysis}
                      windowMinutes={automationConfig.orbWindowMinutes}
                      onChangeWindow={(w) =>
                        setAutomationConfig((prev) => ({...prev, orbWindowMinutes: w}))
                      }
                      onStageOrder={(preset) => {
                        setStagedOrderPreset(preset);
                        setMobileTradePanel('ORDER');
                      }}
                      onArmORBAlerts={(orb) => {
                        const highAlert: PriceAlert = {
                          id: `alrt-orbh-${Date.now()}`,
                          symbol: orb.symbol,
                          condition: 'ABOVE',
                          targetPrice: orb.orHigh,
                          active: true,
                          createdAt: Date.now(),
                          note: `${orb.windowMinutes}m OR High Breakout (LONG)`,
                        };
                        const lowAlert: PriceAlert = {
                          id: `alrt-orbl-${Date.now() + 1}`,
                          symbol: orb.symbol,
                          condition: 'BELOW',
                          targetPrice: orb.orLow,
                          active: true,
                          createdAt: Date.now(),
                          note: `${orb.windowMinutes}m OR Low Breakdown (SHORT)`,
                        };
                        setPriceAlerts((prev) => [highAlert, lowAlert, ...prev]);
                        emitNotification(
                          `ORB Alerts Armed: ${orb.symbol}`,
                          `Armed Long above ${formatPrice(
                            orb.orHigh,
                            selectedInstrument.decimals,
                          )} and Short below ${formatPrice(
                            orb.orLow,
                            selectedInstrument.decimals,
                          )}.`,
                          'SYSTEM',
                          orb.symbol,
                          'alert',
                        );
                      }}
                    />
                  )}
                </div>

                {/* Right Order Ticket + Order Book Depth */}
                <div
                  className={`lg:col-span-3 space-y-4 ${
                    mobileTradePanel === 'ORDER' ? 'block' : 'hidden lg:block'
                  }`}
                >
                  <OrderTicket
                    instrument={selectedInstrument}
                    equity={equity}
                    freeMargin={freeMargin}
                    riskSettings={riskSettings}
                    isOnline={isOnline}
                    externalLimitPrice={externalLimitPrice}
                    stagedOrderPreset={stagedOrderPreset}
                    onSubmitOrder={handleSubmitOrder}
                  />
                  <OrderBookDepth
                    instrument={selectedInstrument}
                    recentPrints={recentPrints}
                    orderFlow={orderFlowSnapshot}
                    onSelectPrice={(p) => {
                      setExternalLimitPrice(p);
                      setMobileTradePanel('ORDER');
                    }}
                    onStageOrder={(preset) => {
                      setStagedOrderPreset(preset);
                      setMobileTradePanel('ORDER');
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-10 text-center text-xs text-slate-500">
                Connecting to real-time CFD & Futures market stream...
              </div>
            )}

            {/* Full-Width Positions & Blotter */}
            <PositionsBlotter
              positions={allPositions}
              pendingOrders={pendingOrders}
              executions={allExecutions}
              instrumentsMap={instrumentsMap}
              isOnline={isOnline}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setMobileTradePanel('CHART');
              }}
              onClosePosition={handleClosePosition}
              onUpdatePositionRisk={handleUpdatePositionRisk}
              onCancelPendingOrder={(id) =>
                setPendingOrders((prev) => prev.filter((o) => o.id !== id))
              }
              onFlattenAll={handleFlattenAll}
            />
          </div>
        )}

        {activeTab === 'bot' && (
          <BotStatsView
            xauInstrument={xauInstrument}
            xauCandles={
              selectedSymbol === 'XAU/USD' && candles.length >= 22
                ? candles
                : candlesBySymbol['XAU/USD'] || xauMtfCandles['15m'] || []
            }
            timeframeLabel={selectedSymbol === 'XAU/USD' ? timeframe : '15m'}
            config={activeBotConfig}
            closedTrades={activeBotTrades}
            openBotPositions={botPositions}
            adaptations={xauBotAdaptations}
            isOnline={isOnline}
            onToggleBot={async () => {
              const next = !activeBotConfig.enabled;
              await syncConfigToBot({...activeBotConfig, enabled: next});
              appendBotLog(
                'INFO',
                next
                  ? `Auto Bot STARTED on live XAU/USD quotes (${activeBotConfig.strategy}, ${activeBotConfig.lotSize} lots).`
                  : 'Auto Bot PAUSED by trader.',
              );
            }}
            onToggleAutoLearn={() => {
              const next = !xauBotConfig.autoLearnEnabled;
              setXauBotConfig((prev) => ({...prev, autoLearnEnabled: next}));
              appendBotLog(
                'LEARN',
                `Automatic self-learning ${next ? 'ENABLED' : 'DISABLED'}.`,
              );
            }}
            onSelectStrategy={async (strategy) => {
              await syncConfigToBot({...activeBotConfig, strategy});
              appendBotLog('LEARN', `Backtest applied strategy: ${strategy}`);
            }}
            onOptimizeNow={() => recordClosedBotTradesAndLearn([], true)}
            onResetLearnedParams={() => {
              const defaults = createDefaultXauBotConfig();
              setXauBotConfig((prev) => ({
                ...defaults,
                enabled: prev.enabled,
                autoLearnEnabled: prev.autoLearnEnabled,
              }));
              appendBotLog(
                'LEARN',
                'Reset bot strategy & risk parameters to baseline defaults.',
              );
            }}
            onClosePosition={(id) => handleClosePosition(id, 1)}
            onGoToLiveChart={() => {
              setSelectedSymbol('XAU/USD');
              setActiveTab('trade');
            }}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioView
            cashBalance={cashBalance}
            dayStartEquity={dayStartEquity}
            equity={equity}
            usedMargin={usedMargin}
            freeMargin={freeMargin}
            marginLevelPct={marginLevelPct}
            unrealizedPnl={unrealizedPnl}
            positions={allPositions}
            instrumentsMap={instrumentsMap}
            riskSettings={riskSettings}
            onUpdateRiskSettings={setRiskSettings}
            lastSyncedAt={lastSyncedAt}
            isOnline={isOnline}
            onSelectSymbolAndTrade={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('trade');
            }}
            brokerStatus={brokerStatus}
            onSyncBroker={handleSyncBroker}
            onToggleBrokerRouting={handleToggleBrokerRouting}
            onResetAccount={handleResetCleanAccount}
          />
        )}

        {activeTab === 'alerts' && (
          <AlertsCenter
            instruments={instruments}
            priceAlerts={priceAlerts}
            notifications={notifications}
            pushPermission={pushPermission}
            riskSettings={riskSettings}
            automationConfig={automationConfig}
            orbScanner={orbScanner}
            onRequestPushPermission={async () => {
              const res = await requestNotificationPermission();
              setPushPermission(res);
            }}
            onSendTestPush={() =>
              emitNotification(
                'Kestrel Alert Test',
                `${selectedInstrument?.symbol || 'ES1!'} push alert channel is active.`,
                'SYSTEM',
                selectedInstrument?.symbol,
                'alert',
              )
            }
            onCreateAlert={({symbol, condition, targetPrice, note}) => {
              const newAlert: PriceAlert = {
                id: `alrt-${Date.now()}`,
                symbol,
                condition,
                targetPrice,
                active: true,
                createdAt: Date.now(),
                note,
              };
              setPriceAlerts((prev) => [newAlert, ...prev]);
            }}
            onDeleteAlert={(id) =>
              setPriceAlerts((prev) => prev.filter((a) => a.id !== id))
            }
            onMarkAllRead={() =>
              setNotifications((prev) => prev.map((n) => ({...n, read: true})))
            }
            onUpdateRiskSettings={setRiskSettings}
            onUpdateAutomationConfig={setAutomationConfig}
            onImportRulesPayload={(jsonText) => {
              try {
                const parsed = JSON.parse(jsonText) as {
                  automationConfig?: Partial<NotificationAutomationConfig>;
                  priceAlerts?: Partial<PriceAlert>[];
                };
                if (!parsed || typeof parsed !== 'object') {
                  return {ok: false, message: 'Invalid JSON structure.'};
                }
                if (parsed.automationConfig) {
                  setAutomationConfig((prev) => ({
                    ...prev,
                    ...parsed.automationConfig,
                  }));
                }
                let importedAlerts = 0;
                if (Array.isArray(parsed.priceAlerts)) {
                  const validAlerts: PriceAlert[] = parsed.priceAlerts
                    .filter(
                      (a) =>
                        typeof a.symbol === 'string' &&
                        (a.condition === 'ABOVE' || a.condition === 'BELOW') &&
                        typeof a.targetPrice === 'number' &&
                        a.targetPrice > 0,
                    )
                    .map((a, idx) => ({
                      id: `alrt-imp-${Date.now()}-${idx}`,
                      symbol: a.symbol!,
                      condition: a.condition!,
                      targetPrice: a.targetPrice!,
                      active: true,
                      createdAt: Date.now(),
                      note: a.note || 'Imported automation rule',
                    }));
                  importedAlerts = validAlerts.length;
                  if (validAlerts.length > 0) {
                    setPriceAlerts((prev) => [...validAlerts, ...prev]);
                  }
                }
                return {
                  ok: true,
                  message: `Imported automation rules${
                    importedAlerts > 0 ? ` and ${importedAlerts} price alert(s)` : ''
                  } successfully.`,
                };
              } catch {
                return {
                  ok: false,
                  message: 'Could not parse JSON. Verify syntax and try again.',
                };
              }
            }}
            onStageFromScanner={(preset) => {
              setSelectedSymbol(preset.symbol);
              setStagedOrderPreset(preset);
              setActiveTab('trade');
              setMobileTradePanel('ORDER');
            }}
          />
        )}

        {activeTab === 'reports' && (
          <EODReportsView
            reports={eodReports}
            onGenerateTodayReport={handleGenerateTodayReport}
            onResetAccount={handleResetCleanAccount}
          />
        )}

        {activeTab === 'security' && (
          <SecurityView
            securityState={securityState}
            riskSettings={riskSettings}
            onUpdateSecurity={setSecurityState}
            onUpdateRiskSettings={setRiskSettings}
            onLockNow={() => setSecurityState((s) => ({...s, isLocked: true}))}
          />
        )}
      </main>

      {/* Actionable Toast Notification Stack */}
      {toastQueue.length > 0 && (
        <div className="fixed top-16 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none">
          {toastQueue.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto rounded-xl border border-slate-200 dark:border-[#283348] bg-white/95 dark:bg-[#141A26]/95 backdrop-blur-md p-3 shadow-xl flex items-start justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-white">
                  {t.title}
                </div>
                <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                  {t.body}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setToastQueue((prev) => prev.filter((item) => item.id !== t.id))
                }
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <OfflineIndicator
        isOnline={isOnline}
        lastSyncedAt={lastSyncedAt}
        simulatedOffline={simulatedOffline}
        onRestoreOnline={() => setSimulatedOffline(false)}
      />

      {/* Full-Screen Session Biometric / PIN Lock */}
      {securityState.isLocked && (
        <SecurityLockModal
          securityState={securityState}
          onUnlock={() =>
            setSecurityState((s) => ({
              ...s,
              isLocked: false,
              lastUnlockedAt: Date.now(),
            }))
          }
        />
      )}

      {/* Pre-Trade Biometric Execution Gate */}
      {pendingBiometricOrder && !securityState.isLocked && (
        <SecurityLockModal
          securityState={securityState}
          title="Confirm Trade Execution"
          subtitle={`Verify identity to submit ${pendingBiometricOrder.side} ${pendingBiometricOrder.quantity} ${pendingBiometricOrder.symbol}.`}
          canCancel
          onCancel={() => setPendingBiometricOrder(null)}
          onUnlock={() => {
            const ord = pendingBiometricOrder;
            setPendingBiometricOrder(null);
            executeOrderInternal(ord);
          }}
        />
      )}
    </div>
  );
}
