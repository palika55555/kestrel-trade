import React from 'react';
import {
  BarChart2,
  Bot,
  Brain,
  Calendar,
  Clock,
  Globe,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {computeUnrealizedPnl, formatCurrency, formatPrice} from '../services/tradingMath';
import type {XauBotEvaluation} from '../services/xauBot';
import type {
  BrokerStatus,
  Instrument,
  Position,
  TradeExecution,
  XauBotConfig,
  XauBotLogEntry,
  XauBotStrategy,
} from '../types/trading';

interface XauAutoBotPanelProps {
  xauInstrument: Instrument | null;
  config: XauBotConfig;
  evaluation: XauBotEvaluation | null;
  botPositions: Position[];
  botExecutions: TradeExecution[];
  logs: XauBotLogEntry[];
  isOnline: boolean;
  server247Enabled: boolean;
  wakeLockActive: boolean;
  onToggleServer247: () => void;
  onOpenCalendar?: () => void;
  onUpdateConfig: (next: XauBotConfig) => void;
  onToggleBot: () => void;
  onEvaluateNow: () => void;
  onRunSamplePaperTrade: (side: 'BUY' | 'SELL') => void;
  onCloseBotPositions: () => void;
  onClearLogs: () => void;
  onOpenStats?: () => void;
  brokerStatus?: BrokerStatus | null;
  onOpenBrokerSettings?: () => void;
}

export const XauAutoBotPanel: React.FC<XauAutoBotPanelProps> = ({
  xauInstrument,
  config,
  evaluation,
  botPositions,
  botExecutions,
  logs,
  isOnline,
  server247Enabled,
  wakeLockActive,
  onToggleServer247,
  onOpenCalendar,
  onUpdateConfig,
  onToggleBot,
  onEvaluateNow,
  onRunSamplePaperTrade,
  onCloseBotPositions,
  onClearLogs,
  onOpenStats,
  brokerStatus,
  onOpenBrokerSettings,
}) => {
  const closedBotExecs = botExecutions.filter((e) => e.action !== 'OPEN');
  const realizedPnl = closedBotExecs.reduce((a, e) => a + e.realizedPnl - e.fee, 0);
  const unrealizedPnl = xauInstrument
    ? botPositions.reduce((a, p) => a + computeUnrealizedPnl(p, xauInstrument), 0)
    : 0;
  const netPnl = realizedPnl + unrealizedPnl;
  const wins = closedBotExecs.filter((e) => e.realizedPnl > 0).length;
  const losses = closedBotExecs.filter((e) => e.realizedPnl < 0).length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

  // Daily limit counts only today's closed trades (+ open positions); netPnl above stays all-time.
  const today = new Date().toDateString();
  const dailyPnl =
    closedBotExecs
      .filter((e) => new Date(e.timestamp).toDateString() === today)
      .reduce((a, e) => a + e.realizedPnl - e.fee, 0) + unrealizedPnl;
  const circuitBreakerHit = dailyPnl <= -Math.abs(config.maxDailyLossDollars);

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      {/* Header & Primary Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
        <div className="flex items-start gap-2.5">
          <Bot
            className={`w-4 h-4 mt-0.5 shrink-0 ${
              config.enabled ? 'text-emerald-500' : 'text-blue-500'
            }`}
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                XAU/USD Automated Test Bot
              </h2>
              <span className="text-xs text-slate-400">·</span>
              <span
                className={`text-xs font-mono font-semibold ${
                  config.enabled
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {config.enabled ? 'RUNNING ON LIVE FEED' : 'PAUSED'}
              </span>
              {xauInstrument && (
                <>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                    {formatPrice(xauInstrument.bid, 2)} / {formatPrice(xauInstrument.ask, 2)} (
                    {xauInstrument.dataSource || 'Swissquote BBO'})
                  </span>
                </>
              )}
              {onOpenBrokerSettings && (
                <>
                  <span className="text-xs text-slate-400">·</span>
                  <button
                    type="button"
                    onClick={onOpenBrokerSettings}
                    className={`text-[11px] font-semibold cursor-pointer hover:underline ${
                      brokerStatus?.routingArmed
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {brokerStatus?.routingArmed
                      ? `Live Broker: ${brokerStatus.provider}`
                      : 'Paper Mode · Connect Broker'}
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Autonomous XAU/USD bot executing Long/Short positions on live quotes (Paper or Real Broker via OANDA / MT4 / MT5).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!isOnline || circuitBreakerHit}
            onClick={onToggleBot}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg text-white transition-colors disabled:opacity-45 cursor-pointer ${
              config.enabled
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {config.enabled ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause Bot</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Start Auto Bot</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!isOnline}
            onClick={onEvaluateNow}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] disabled:opacity-40 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-blue-500" />
            <span>Check Signal Now</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateConfig({
                ...config,
                autoLearnEnabled: !config.autoLearnEnabled,
              })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              config.autoLearnEnabled
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Auto-Learn: {config.autoLearnEnabled ? 'On' : 'Off'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateConfig({
                ...config,
                useOrderFlowConfluence: !config.useOrderFlowConfluence,
              })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              config.useOrderFlowConfluence
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Order Flow: {config.useOrderFlowConfluence ? 'On' : 'Off'}</span>
          </button>

          <button
            type="button"
            disabled={!isOnline}
            onClick={onToggleServer247}
            title="Run bot inside Node.js backend 24/7 even when browser tab is closed"
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-45 cursor-pointer ${
              server247Enabled
                ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300'
                : 'border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1B2232]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>
              {server247Enabled
                ? '24/7 Server: ON'
                : wakeLockActive
                ? '24/7 Server: OFF (Browser)'
                : '24/7 Server: OFF'}
            </span>
          </button>

          {onOpenStats && (
            <button
              type="button"
              onClick={onOpenStats}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] cursor-pointer"
            >
              <BarChart2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Stats &amp; Learning</span>
            </button>
          )}

          {botPositions.length > 0 && (
            <button
              type="button"
              disabled={!isOnline}
              onClick={onCloseBotPositions}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-rose-500/35 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 cursor-pointer"
            >
              Close Bot Trades ({botPositions.length})
            </button>
          )}
        </div>
      </div>

      {/* Bot Performance KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Bot Net P&amp;L</div>
          <div
            className={`mt-0.5 text-sm font-mono font-semibold tabular-nums ${
              netPnl >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {netPnl >= 0 ? '+' : ''}
            {formatCurrency(netPnl)}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Closed / Win Rate</div>
          <div className="mt-0.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
            {closedBotExecs.length} ({winRate.toFixed(0)}%)
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Open Bot Trades</div>
          <div className="mt-0.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
            {botPositions.length}/{config.maxConcurrentPositions} ·{' '}
            {botPositions.reduce((a, p) => a + p.quantity, 0).toFixed(2)} lots
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Live Signal</div>
          <div
            className={`mt-0.5 text-sm font-mono font-semibold ${
              evaluation?.action === 'BUY'
                ? 'text-emerald-600 dark:text-emerald-400'
                : evaluation?.action === 'SELL'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {evaluation ? `${evaluation.action} (${evaluation.confidence}%)` : '--'}
          </div>
        </div>
      </div>

      {/* Precision Filters & Profit Protection Modules */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              useMtfConfluence: !(config.useMtfConfluence ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${
            (config.useMtfConfluence ?? true)
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              MTF 15m/1H
            </span>
            <span className="font-mono">
              {(config.useMtfConfluence ?? true) ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-mono tabular-nums truncate opacity-85">
            {evaluation ? `Bias: ${evaluation.mtfBias}` : 'Loading MTF...'}
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              useMacroConfluence: !(config.useMacroConfluence ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${
            (config.useMacroConfluence ?? true)
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <span className="inline-flex items-center gap-1">
              <Globe className="w-3 h-3" />
              DXY / GC1!
            </span>
            <span className="font-mono">
              {(config.useMacroConfluence ?? true) ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-mono tabular-nums truncate opacity-85">
            {evaluation?.macro
              ? `${evaluation.macro.macroBias} · DXY ${evaluation.macro.dxyChangePct >= 0 ? '+' : ''}${evaluation.macro.dxyChangePct}%`
              : 'Syncing macro...'}
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              useSessionSpreadGuard: !(config.useSessionSpreadGuard ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${
            (config.useSessionSpreadGuard ?? true)
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Session/Spread
            </span>
            <span className="font-mono">
              {(config.useSessionSpreadGuard ?? true) ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-mono tabular-nums truncate opacity-85">
            {evaluation
              ? `${evaluation.sessionInfo.liquidityQuality} · $${evaluation.sessionInfo.spreadDollars.toFixed(2)}`
              : 'Checking spread...'}
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              autoBreakEvenEnabled: !(config.autoBreakEvenEnabled ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${
            (config.autoBreakEvenEnabled ?? true)
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Auto BE
            </span>
            <span className="font-mono">
              {(config.autoBreakEvenEnabled ?? true) ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-mono truncate opacity-85">
            SL to Entry @ +50% TP
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              partialTpEnabled: !(config.partialTpEnabled ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-2 transition-colors cursor-pointer ${
            (config.partialTpEnabled ?? true)
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <span>Partial TP</span>
            <span className="font-mono">
              {(config.partialTpEnabled ?? true) ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-mono truncate opacity-85">
            Bank 50% @ +70% TP
          </div>
        </button>

        <div
          className={`rounded-lg border px-2.5 py-2 transition-colors ${
            evaluation?.newsStatus?.blocked
              ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : (config.useNewsGuard ?? true)
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between gap-1 font-semibold text-[11px]">
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  ...config,
                  useNewsGuard: !(config.useNewsGuard ?? true),
                })
              }
              className="inline-flex items-center gap-1 cursor-pointer hover:underline"
            >
              <Calendar className="w-3 h-3" />
              <span>News Guard</span>
            </button>
            <button
              type="button"
              onClick={onOpenCalendar}
              className="font-mono cursor-pointer hover:underline"
            >
              {(config.useNewsGuard ?? true) ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="mt-0.5 text-[10px] font-mono truncate opacity-85">
            {evaluation?.newsStatus?.blocked
              ? `PAUSED: ${evaluation.newsStatus.reason}`
              : evaluation?.newsStatus?.nextEvent && evaluation.newsStatus.minutesUntilNext !== null
              ? `${evaluation.newsStatus.nextEvent.title.slice(0, 14)} (${evaluation.newsStatus.minutesUntilNext}m)`
              : 'Clear (±15m)'}
          </div>
        </div>
      </div>

      {/* Live Evaluation Box + Instant Paper Test Trigger */}
      {evaluation && (
        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              Live Strategy Readout:{' '}
              <span className="font-mono text-blue-600 dark:text-blue-400">
                {evaluation.reason}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
              <span>EMA9 {formatPrice(evaluation.indicators.ema9, 2)}</span>
              <span>EMA21 {formatPrice(evaluation.indicators.ema21, 2)}</span>
              <span>VWAP {formatPrice(evaluation.indicators.vwap, 2)}</span>
              <span>RSI {evaluation.indicators.rsi14}</span>
              {evaluation.orderFlow && (
                <>
                  <span>Buyers {evaluation.orderFlow.buyPressurePct}%</span>
                  <span>Book Bids {evaluation.orderFlow.bookImbalancePct}%</span>
                  <span>POC {formatPrice(evaluation.orderFlow.pocPrice, 2)}</span>
                  <span>ATR {formatPrice(evaluation.orderFlow.atr14, 2)}</span>
                </>
              )}
            </div>
            {(evaluation.mtfTrends.length > 0 || evaluation.macro) && (
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums border-t border-slate-200/70 dark:border-[#1E2636] pt-1.5">
                {evaluation.mtfTrends.map((t) => (
                  <span
                    key={t.timeframe}
                    className={
                      t.trend === 'BULLISH'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : t.trend === 'BEARISH'
                        ? 'text-rose-600 dark:text-rose-400'
                        : ''
                    }
                  >
                    {t.timeframe} {t.trend === 'BULLISH' ? '↑' : t.trend === 'BEARISH' ? '↓' : '→'}
                  </span>
                ))}
                {evaluation.macro && (
                  <>
                    <span>
                      DXY {evaluation.macro.dxyPrice.toFixed(2)} (
                      {evaluation.macro.dxyChangePct >= 0 ? '+' : ''}
                      {evaluation.macro.dxyChangePct}%)
                    </span>
                    <span>
                      US10Y {evaluation.macro.us10yYield.toFixed(2)}%
                    </span>
                    <span>
                      GC1! Basis {evaluation.macro.gcBasis >= 0 ? '+' : ''}$
                      {evaluation.macro.gcBasis.toFixed(2)}
                    </span>
                  </>
                )}
                <span>
                  {evaluation.sessionInfo.sessionLabel} · Spread $
                  {evaluation.sessionInfo.spreadDollars.toFixed(2)}
                </span>
                {evaluation.atasSignals && (
                  <span>
                    ATAS:{' '}
                    {evaluation.atasSignals.stackedImbalance !== 'NONE'
                      ? evaluation.atasSignals.stackedImbalance.replace('_', ' ')
                      : evaluation.atasSignals.absorptionSignal !== 'NONE'
                      ? evaluation.atasSignals.absorptionSignal.replace('_', ' ')
                      : evaluation.atasSignals.cvdDivergence !== 'NONE'
                      ? `CVD ${evaluation.atasSignals.cvdDivergence}`
                      : 'Balanced'}
                  </span>
                )}
                {evaluation.institutional && (
                  <>
                    <span>
                      PAXG {evaluation.institutional.paxgBuyPct}% Buy
                    </span>
                    {evaluation.institutional.gvz !== null && (
                      <span className={evaluation.institutional.volatilityAlert ? 'text-amber-500 font-semibold' : ''}>
                        GVZ {evaluation.institutional.gvz.toFixed(1)}
                      </span>
                    )}
                    {evaluation.institutional.gldPrice !== null && (
                      <span>
                        GLD {evaluation.institutional.gldChangePct >= 0 ? '+' : ''}
                        {evaluation.institutional.gldChangePct}%
                      </span>
                    )}
                    {evaluation.institutional.cot && (
                      <span>
                        COT MM {evaluation.institutional.cot.managedMoneyNet >= 0 ? '+' : ''}
                        {Math.round(evaluation.institutional.cot.managedMoneyNet / 1000)}k
                      </span>
                    )}
                    {evaluation.institutional.tipPrice != null && (
                      <span>
                        TIP {(evaluation.institutional.tipChangePct ?? 0) >= 0 ? '+' : ''}
                        {evaluation.institutional.tipChangePct ?? 0}%
                      </span>
                    )}
                    {evaluation.institutional.gdxPrice != null && (
                      <span>
                        GDX {(evaluation.institutional.gdxChangePct ?? 0) >= 0 ? '+' : ''}
                        {evaluation.institutional.gdxChangePct ?? 0}%
                      </span>
                    )}
                    {evaluation.institutional.smtDivergence &&
                      evaluation.institutional.smtDivergence !== 'NONE' && (
                        <span
                          className={
                            evaluation.institutional.smtDivergence === 'BULLISH_SMT'
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-rose-600 dark:text-rose-400 font-semibold'
                          }
                        >
                          {evaluation.institutional.smtDivergence.replace('_', ' ')}
                        </span>
                      )}
                    {evaluation.institutional.futuresRegime &&
                      evaluation.institutional.futuresRegime !== 'NEUTRAL' && (
                        <span>
                          OI {evaluation.institutional.futuresRegime.replace('_', ' ')}
                        </span>
                      )}
                    {evaluation.institutional.l2WallVelocity &&
                      evaluation.institutional.l2WallVelocity !== 'BALANCED' && (
                        <span>
                          DOM {evaluation.institutional.l2WallVelocity.replace('_', ' ')}
                        </span>
                      )}
                  </>
                )}
                <span>Regime: {evaluation.regime}</span>
                <span>
                  Eff SL ${evaluation.effectiveSlDollars.toFixed(1)} · Lot{' '}
                  {evaluation.effectiveLotSize.toFixed(2)}
                </span>
                {evaluation.antiTilt.trailingLosses >= 2 && (
                  <span className="text-amber-500 font-semibold">
                    Anti-Tilt {evaluation.antiTilt.active ? 'Cooldown' : 'Half-Lot Recovery'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => onRunSamplePaperTrade('BUY')}
              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/25 disabled:opacity-40 cursor-pointer"
            >
              Test Bot Long
            </button>
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => onRunSamplePaperTrade('SELL')}
              className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-rose-600/15 text-rose-700 dark:text-rose-400 hover:bg-rose-600/25 disabled:opacity-40 cursor-pointer"
            >
              Test Bot Short
            </button>
          </div>
        </div>
      )}

      {/* Strategy & Risk Parameters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Strategy Engine
          </label>
          <select
            value={config.strategy}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                strategy: e.target.value as XauBotStrategy,
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="SMART_ENSEMBLE">Smart Regime Ensemble (Multi-Strategy)</option>
            <option value="ORB_VWAP">ORB Breakout + VWAP Confluence</option>
            <option value="LIQUIDITY_SWEEP_SMC">Liquidity Sweep + FVG Reversal</option>
            <option value="ORDERFLOW_LIQUIDITY">Order Flow + POC / Liquidity</option>
            <option value="EMA_MOMENTUM">EMA 9/21 + VWAP + RSI Momentum</option>
            <option value="BOLLINGER_REVERSION">Bollinger + RSI Mean Reversion</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Lot Size (XAU)
          </label>
          <input
            type="number"
            min={0.01}
            max={5}
            step={0.05}
            value={config.lotSize}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                lotSize: Math.max(0.01, Number(e.target.value) || 0.1),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Min Confidence (%)
          </label>
          <input
            type="number"
            min={30}
            max={95}
            step={5}
            value={config.minConfidence}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                minConfidence: Math.max(30, Math.min(95, Number(e.target.value) || 55)),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Stop-Loss ($/oz)
          </label>
          <input
            type="number"
            min={1}
            max={100}
            step={0.5}
            value={config.stopLossDollars}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                stopLossDollars: Math.max(1, Number(e.target.value) || 8),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Take-Profit ($/oz)
          </label>
          <input
            type="number"
            min={1}
            max={250}
            step={0.5}
            value={config.takeProfitDollars}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                takeProfitDollars: Math.max(1, Number(e.target.value) || 16),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Cooldown (sec)
          </label>
          <input
            type="number"
            min={5}
            max={600}
            step={5}
            value={config.cooldownSeconds}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                cooldownSeconds: Math.max(5, Number(e.target.value) || 45),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Max Bot Loss ($)
          </label>
          <input
            type="number"
            min={100}
            max={50000}
            step={100}
            value={config.maxDailyLossDollars}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                maxDailyLossDollars: Math.max(100, Number(e.target.value) || 1200),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Max Open Trades (1–10)
          </label>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={config.maxConcurrentPositions}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                maxConcurrentPositions: Math.max(
                  1,
                  Math.min(10, Math.round(Number(e.target.value) || 1)),
                ),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Trailing Stop ($/oz, 0=Off)
          </label>
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={config.trailingStopDollars ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              onUpdateConfig({
                ...config,
                trailingStopDollars: v > 0 ? Math.min(50, v) : null,
              });
            }}
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Max Spread ($/oz)
          </label>
          <input
            type="number"
            min={0.2}
            max={5}
            step={0.1}
            value={config.maxSpreadDollars ?? 1.2}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                maxSpreadDollars: Math.max(0.2, Math.min(5, Number(e.target.value) || 1.2)),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 flex flex-col justify-center">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Runner Scaling
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300 truncate">
            {config.maxConcurrentPositions > 1
              ? `${config.maxConcurrentPositions} slots · TP 1.0x→${(
                  1 +
                  (config.maxConcurrentPositions - 1) * 0.35
                ).toFixed(2)}x`
              : 'Single-trade mode'}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Risk % / Trade (0=Fixed)
          </label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.25}
            value={config.riskPerTradePct ?? 0}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                riskPerTradePct: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Time-Stop Exit (min, 0=Off)
          </label>
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            value={config.staleTradeMinutes ?? 45}
            onChange={(e) =>
              onUpdateConfig({
                ...config,
                staleTradeMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)),
              })
            }
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              useAtrRiskScaling: !(config.useAtrRiskScaling ?? true),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${
            (config.useAtrRiskScaling ?? true)
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>ATR Dynamic SL/TP</span>
            <span className="font-mono">{(config.useAtrRiskScaling ?? true) ? 'ON' : 'OFF'}</span>
          </div>
          <div className="text-[10px] font-mono opacity-80 truncate">
            Wick-proof stop buffer
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ...config,
              useKillzonesOnly: !(config.useKillzonesOnly ?? false),
            })
          }
          className={`text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${
            (config.useKillzonesOnly ?? false)
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-500 dark:text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>Killzones Only</span>
            <span className="font-mono">{(config.useKillzonesOnly ?? false) ? 'ON' : 'OFF'}</span>
          </div>
          <div className="text-[10px] font-mono opacity-80 truncate">
            LDN/NY Prime Hours
          </div>
        </button>
      </div>

      {circuitBreakerHit && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          Bot daily loss circuit breaker reached (-{formatCurrency(config.maxDailyLossDollars)}). Increase Max Bot Loss to resume.
        </div>
      )}

      {/* Bot Decision & Execution Log */}
      <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 dark:bg-[#0D1119] border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Bot Activity &amp; Execution Log
          </span>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={onClearLogs}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
        <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1A2130] text-[11px] font-mono">
          {logs.length === 0 ? (
            <div className="p-4 text-center font-sans text-slate-500 dark:text-slate-400">
              Start the Auto Bot or click &quot;Check Signal Now&quot; to stream XAU/USD strategy evaluations.
            </div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className="px-3 py-1.5 flex items-start gap-2.5"
              >
                <span className="text-slate-400 shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={`font-semibold shrink-0 ${
                    entry.level === 'EXECUTION'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : entry.level === 'SIGNAL'
                      ? 'text-blue-600 dark:text-blue-400'
                      : entry.level === 'LEARN'
                      ? 'text-violet-600 dark:text-violet-400'
                      : entry.level === 'RISK'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  [{entry.level}]
                </span>
                <span className="text-slate-700 dark:text-slate-300 font-sans">
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
