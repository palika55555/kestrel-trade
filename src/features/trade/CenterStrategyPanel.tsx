import React, {type Dispatch, type SetStateAction} from 'react';
import {DomLevel2Panel} from '../../components/DomLevel2Panel';
import {EconomicCalendarPanel} from '../../components/EconomicCalendarPanel';
import {ORBAnalysisPanel} from '../../components/ORBAnalysisPanel';
import {OrderFlowPanel} from '../../components/OrderFlowPanel';
import {XauAutoBotPanel} from '../../components/XauAutoBotPanel';
import {isGoldSymbol, type DerivedTradingData} from '../../hooks/useDerivedTradingData';
import type {XauBotActions} from '../../hooks/useXauBotActions';
import {formatPrice} from '../../services/tradingMath';
import type {
  ActiveTab,
  BrokerStatus,
  EconomicCalendarSnapshot,
  InstitutionalGoldContext,
  Instrument,
  NotificationAutomationConfig,
  Position,
  PriceAlert,
  StagedOrderPreset,
  TradeExecution,
  XauBotConfig,
  XauBotLogEntry,
} from '../../types/trading';
import type {EmitNotification} from '../market/tickContext';
import type {CenterSubTab, MobileTradePanel} from './types';

export interface CenterStrategyPanelProps {
  selectedInstrument: Instrument;
  selectedSymbol: string;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  centerSubTab: CenterSubTab;
  setCenterSubTab: Dispatch<SetStateAction<CenterSubTab>>;
  setMobileTradePanel: Dispatch<SetStateAction<MobileTradePanel>>;
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  isOnline: boolean;
  xauInstrument: Instrument | null;
  activeBotConfig: XauBotConfig;
  xauBotEvaluation: DerivedTradingData['xauBotEvaluation'];
  botPositions: Position[];
  botExecutions: TradeExecution[];
  activeBotLogs: XauBotLogEntry[];
  server247Enabled: boolean;
  wakeLockActive: boolean;
  brokerStatus: BrokerStatus | null;
  handleToggleServer247: () => Promise<void>;
  syncConfigToBot: (next: XauBotConfig) => Promise<void>;
  botActions: XauBotActions;
  setXauBotLogs: Dispatch<SetStateAction<XauBotLogEntry[]>>;
  calendarSnapshot: EconomicCalendarSnapshot | null;
  setCalendarSnapshot: Dispatch<SetStateAction<EconomicCalendarSnapshot | null>>;
  orderFlowSnapshot: DerivedTradingData['orderFlowSnapshot'];
  institutionalGold: InstitutionalGoldContext | null;
  activeOrbAnalysis: DerivedTradingData['activeOrbAnalysis'];
  automationConfig: NotificationAutomationConfig;
  setAutomationConfig: Dispatch<SetStateAction<NotificationAutomationConfig>>;
  setStagedOrderPreset: Dispatch<SetStateAction<StagedOrderPreset | null>>;
  setPriceAlerts: Dispatch<SetStateAction<PriceAlert[]>>;
  emitNotification: EmitNotification;
}

/**
 * Center column of the Trade tab below the chart: strategy sub-tab switcher
 * and the XAU Auto Bot / Economic Calendar / Order Flow / ORB panels.
 */
export function CenterStrategyPanel({
  selectedInstrument,
  selectedSymbol,
  setSelectedSymbol,
  centerSubTab,
  setCenterSubTab,
  setMobileTradePanel,
  setActiveTab,
  isOnline,
  xauInstrument,
  activeBotConfig,
  xauBotEvaluation,
  botPositions,
  botExecutions,
  activeBotLogs,
  server247Enabled,
  wakeLockActive,
  brokerStatus,
  handleToggleServer247,
  syncConfigToBot,
  botActions,
  setXauBotLogs,
  calendarSnapshot,
  setCalendarSnapshot,
  orderFlowSnapshot,
  institutionalGold,
  activeOrbAnalysis,
  automationConfig,
  setAutomationConfig,
  setStagedOrderPreset,
  setPriceAlerts,
  emitNotification,
}: CenterStrategyPanelProps) {
  return (
    <>
      {/* Center Strategy / Bot Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-1">
          <button
            type="button"
            onClick={() => setCenterSubTab('XAU_BOT')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
            onClick={() => setCenterSubTab('DOM_L2')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              centerSubTab === 'DOM_L2'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            DOM Level 2
          </button>
          <button
            type="button"
            onClick={() => setCenterSubTab('ORDER_FLOW')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
          onToggleServer247={handleToggleServer247}
          onOpenCalendar={() => setCenterSubTab('CALENDAR')}
          onUpdateConfig={syncConfigToBot}
          onToggleBot={botActions.toggleBotFromTradePanel}
          onEvaluateNow={botActions.evaluateNow}
          onRunSamplePaperTrade={botActions.runSamplePaperTrade}
          onCloseBotPositions={botActions.closeBotPositions}
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
      ) : centerSubTab === 'DOM_L2' ? (
        <DomLevel2Panel
          instrument={selectedInstrument}
          orderFlow={orderFlowSnapshot}
          isOnline={isOnline}
          onStageOrder={(preset) => {
            setStagedOrderPreset(preset);
            setMobileTradePanel('ORDER');
          }}
        />
      ) : centerSubTab === 'ORDER_FLOW' ? (
        <OrderFlowPanel
          instrument={selectedInstrument}
          snapshot={orderFlowSnapshot}
          institutional={isGoldSymbol(selectedInstrument.symbol) ? institutionalGold : null}
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
    </>
  );
}
