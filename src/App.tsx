import React, {useState} from 'react';
import {BotStatsView} from './components/BotStatsView';
import {EODReportsView} from './components/EODReportsView';
import {OfflineIndicator} from './components/OfflineIndicator';
import {PortfolioView} from './components/PortfolioView';
import {SecurityLockModal} from './components/SecurityLockModal';
import {SecurityView} from './components/SecurityView';
import {TopBar} from './components/TopBar';
import {AlertsTab} from './features/alerts/AlertsTab';
import {AccountStrip} from './features/layout/AccountStrip';
import {resolveDisplayAccount} from './services/displayAccount';
import {ToastStack} from './features/layout/ToastStack';
import {TradeTab} from './features/trade/TradeTab';
import type {CenterSubTab, MobileTradePanel} from './features/trade/types';
import {useAccountActions} from './hooks/useAccountActions';
import {useCandles} from './hooks/useCandles';
import {useDerivedTradingData} from './hooks/useDerivedTradingData';
import {useLiveRefs} from './hooks/useLiveRefs';
import {
  useGoldContextPolling,
  useMarketFeedState,
  useOrderFlowPolling,
} from './hooks/useMarketFeeds';
import {useMarketStream} from './hooks/useMarketStream';
import {useNotifications} from './hooks/useNotifications';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {
  useServerBotControls,
  useServerBotPolling,
  useServerBotState,
} from './hooks/useServerBot';
import {useTheme} from './hooks/useTheme';
import {useTradeActions} from './hooks/useTradeActions';
import {useWakeLock} from './hooks/useWakeLock';
import {useWorkspace} from './hooks/useWorkspace';
import {useXauBotActions} from './hooks/useXauBotActions';
import {useXauBotLearning} from './hooks/useXauBotLearning';
import type {PendingOrderPayload} from './lib/orderPayload';
import type {ActiveTab, StagedOrderPreset, Timeframe} from './types/trading';

export default function App() {
  // NOTE: hook call order below mirrors the original effect order
  // (theme -> workspace hydrate/persist -> candles -> market stream ->
  // order flow -> gold context -> server bot poll -> wake lock).
  const {isOnline, simulatedOffline, setSimulatedOffline} = useOnlineStatus();
  const {isDark, setIsDark} = useTheme();

  const [activeTab, setActiveTab] = useState<ActiveTab>('trade');
  const [mobileTradePanel, setMobileTradePanel] = useState<MobileTradePanel>('CHART');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('XAU/USD');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [centerSubTab, setCenterSubTab] = useState<CenterSubTab>('XAU_BOT');
  const [stagedOrderPreset, setStagedOrderPreset] = useState<StagedOrderPreset | null>(null);
  const [externalLimitPrice, setExternalLimitPrice] = useState<number | null>(null);
  const [pendingBiometricOrder, setPendingBiometricOrder] =
    useState<PendingOrderPayload | null>(null);

  const workspace = useWorkspace();
  const {
    hasSavedWorkspaceRef,
    anchoredLiveRef,
    instruments,
    setInstruments,
    cashBalance,
    setCashBalance,
    dayStartEquity,
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
  } = workspace;

  const {
    recentPrints,
    setRecentPrints,
    xauRecentPrints,
    setXauRecentPrints,
    xauMtfCandles,
    setXauMtfCandles,
    goldMacro,
    setGoldMacro,
    institutionalGold,
    setInstitutionalGold,
    calendarSnapshot,
    setCalendarSnapshot,
  } = useMarketFeedState();

  const serverBot = useServerBotState();
  const {server247Enabled, serverBotState, setServerBotState, brokerStatus} = serverBot;

  const {candles, setCandles, candlesBySymbol, candlesRef, candlesBySymbolRef} = useCandles(
    selectedSymbol,
    timeframe,
    isOnline,
    instruments,
    brokerStatus?.provider,
    brokerStatus?.lastSyncedAt,
  );

  const {emitNotification, toastQueue, setToastQueue, pushPermission, setPushPermission} =
    useNotifications(riskSettings, setNotifications);

  const liveRefs = useLiveRefs({
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
  });

  const {appendBotLog, recordClosedBotTradesAndLearn} = useXauBotLearning({
    setXauBotLogs,
    setXauBotTrades,
    setXauBotConfig,
    setXauBotAdaptations,
    xauBotTradesRef: liveRefs.xauBotTradesRef,
    xauBotConfigRef: liveRefs.xauBotConfigRef,
    emitNotification,
  });

  const streamConnected = useMarketStream(
    isOnline,
    {
      ...liveRefs,
      hasSavedWorkspaceRef,
      anchoredLiveRef,
      candlesRef,
      candlesBySymbolRef,
      server247EnabledRef: serverBot.server247EnabledRef,
      setInstruments,
      setLastSyncedAt,
      setCandles,
      setPositions,
      setPendingOrders,
      setExecutions,
      setPriceAlerts,
      setCashBalance,
      setXauBotConfig,
    },
    emitNotification,
    appendBotLog,
    recordClosedBotTradesAndLearn,
  );

  useOrderFlowPolling(
    selectedSymbol,
    isOnline,
    liveRefs.xauBotConfigRef,
    setRecentPrints,
    setXauRecentPrints,
  );
  useGoldContextPolling(
    isOnline,
    liveRefs.xauBotConfigRef,
    setXauMtfCandles,
    setGoldMacro,
    setInstitutionalGold,
    setCalendarSnapshot,
    brokerStatus?.provider,
    brokerStatus?.lastSyncedAt,
  );
  useServerBotPolling(isOnline, serverBot);
  const wakeLockActive = useWakeLock(xauBotConfig, server247Enabled);

  const {syncConfigToBot, handleToggleServer247, handleSyncBroker, handleToggleBrokerRouting} =
    useServerBotControls({
      isOnline,
      serverBot,
      xauBotConfigRef: liveRefs.xauBotConfigRef,
      setXauBotConfig,
      appendBotLog,
      emitNotification,
    });

  const derived = useDerivedTradingData({
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
  });
  const {
    instrumentsMap,
    selectedInstrument,
    orbScanner,
    xauInstrument,
    activeBotConfig,
    botPositions,
    activeBotTrades,
    allPositions,
    unrealizedPnl,
    usedMargin,
    equity,
    freeMargin,
    marginLevelPct,
    dailyPnl,
  } = derived;
  // While live routing is armed the header and portfolio describe the broker account, not the paper ledger.
  const displayAccount = resolveDisplayAccount(
    {cashBalance, dayStartEquity, equity, usedMargin, freeMargin, marginLevelPct, unrealizedPnl, dailyPnl},
    brokerStatus,
  );
  // The tick handler's early-exit check reads the latest evaluation through this ref.
  liveRefs.latestXauEvalRef.current = derived.xauBotEvaluation;

  const tradeActions = useTradeActions({
    isOnline,
    instrumentsMap,
    selectedInstrument,
    positions,
    riskSettings,
    securityState,
    serverBotState,
    xauBotConfig,
    setPositions,
    setPendingOrders,
    setExecutions,
    setCashBalance,
    setServerBotState,
    setPendingBiometricOrder,
    emitNotification,
    appendBotLog,
    recordClosedBotTradesAndLearn,
  });
  const {executeOrderInternal, handleClosePosition} = tradeActions;

  const {handleGenerateTodayReport, handleResetCleanAccount} = useAccountActions({
    workspace,
    instrumentsMap,
    equity,
    unrealizedPnl,
    usedMargin,
    setServer247Enabled: serverBot.setServer247Enabled,
    setServerBotState,
    setBrokerStatus: serverBot.setBrokerStatus,
    emitNotification,
  });

  const botActions = useXauBotActions({
    activeBotConfig,
    xauBotConfig,
    xauInstrument,
    xauBotEvaluation: derived.xauBotEvaluation,
    botPositions,
    selectedSymbol,
    server247Enabled,
    xauBotLastTradeRef: liveRefs.xauBotLastTradeRef,
    setSelectedSymbol,
    setXauBotConfig,
    setServerBotState,
    syncConfigToBot,
    executeOrderInternal,
    handleClosePosition,
    appendBotLog,
  });

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
      <AccountStrip
        equity={displayAccount.equity}
        dailyPnl={displayAccount.dailyPnl}
        freeMargin={displayAccount.freeMargin}
        usedMargin={displayAccount.usedMargin}
        marginLevelPct={displayAccount.marginLevelPct}
        sourceLabel={displayAccount.source === 'BROKER' ? displayAccount.sourceLabel : null}
        isOnline={isOnline}
        streamConnected={streamConnected}
        setSimulatedOffline={setSimulatedOffline}
        isDark={isDark}
        setIsDark={setIsDark}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 mx-auto w-full max-w-[1600px] px-3 sm:px-4 lg:px-6 py-4">
        {activeTab === 'trade' && (
          <TradeTab
            derived={derived}
            tradeActions={tradeActions}
            centerPanelProps={{
              selectedSymbol,
              setSelectedSymbol,
              centerSubTab,
              setCenterSubTab,
              setMobileTradePanel,
              setActiveTab,
              isOnline,
              xauInstrument,
              activeBotConfig,
              xauBotEvaluation: derived.xauBotEvaluation,
              botPositions,
              botExecutions: derived.botExecutions,
              activeBotLogs: derived.activeBotLogs,
              server247Enabled,
              wakeLockActive,
              brokerStatus,
              handleToggleServer247,
              syncConfigToBot,
              botActions,
              setXauBotLogs,
              calendarSnapshot,
              setCalendarSnapshot,
              orderFlowSnapshot: derived.orderFlowSnapshot,
              institutionalGold,
              activeOrbAnalysis: derived.activeOrbAnalysis,
              automationConfig,
              setAutomationConfig,
              setStagedOrderPreset,
              setPriceAlerts,
              emitNotification,
            }}
            instruments={instruments}
            setSelectedSymbol={setSelectedSymbol}
            mobileTradePanel={mobileTradePanel}
            setMobileTradePanel={setMobileTradePanel}
            candles={candles}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            priceAlerts={priceAlerts}
            drawings={drawings}
            setDrawings={setDrawings}
            isOnline={isOnline}
            isDark={isDark}
            riskSettings={riskSettings}
            externalLimitPrice={externalLimitPrice}
            setExternalLimitPrice={setExternalLimitPrice}
            stagedOrderPreset={stagedOrderPreset}
            setStagedOrderPreset={setStagedOrderPreset}
            recentPrints={recentPrints}
            pendingOrders={pendingOrders}
            setPendingOrders={setPendingOrders}
          />
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
            onToggleBot={botActions.toggleBotFromStats}
            onToggleAutoLearn={botActions.toggleAutoLearn}
            onSelectStrategy={async (strategy) => {
              await syncConfigToBot({...activeBotConfig, strategy});
              appendBotLog('LEARN', `Backtest applied strategy: ${strategy}`);
            }}
            onOptimizeNow={() => recordClosedBotTradesAndLearn([], true)}
            onResetLearnedParams={botActions.resetLearnedParams}
            onClosePosition={(id) => handleClosePosition(id, 1)}
            onGoToLiveChart={() => {
              setSelectedSymbol('XAU/USD');
              setActiveTab('trade');
            }}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioView
            cashBalance={displayAccount.cashBalance}
            dayStartEquity={displayAccount.dayStartEquity}
            equity={displayAccount.equity}
            usedMargin={displayAccount.usedMargin}
            freeMargin={displayAccount.freeMargin}
            marginLevelPct={displayAccount.marginLevelPct}
            unrealizedPnl={displayAccount.unrealizedPnl}
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
          <AlertsTab
            instruments={instruments}
            selectedInstrument={selectedInstrument}
            priceAlerts={priceAlerts}
            setPriceAlerts={setPriceAlerts}
            notifications={notifications}
            setNotifications={setNotifications}
            pushPermission={pushPermission}
            setPushPermission={setPushPermission}
            riskSettings={riskSettings}
            setRiskSettings={setRiskSettings}
            automationConfig={automationConfig}
            setAutomationConfig={setAutomationConfig}
            orbScanner={orbScanner}
            emitNotification={emitNotification}
            setSelectedSymbol={setSelectedSymbol}
            setStagedOrderPreset={setStagedOrderPreset}
            setActiveTab={setActiveTab}
            setMobileTradePanel={setMobileTradePanel}
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
      <ToastStack toastQueue={toastQueue} setToastQueue={setToastQueue} />

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
