import React, {useMemo, useState} from 'react';
import {
  Brain,
  Download,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {computeUnrealizedPnl, formatCurrency, formatPrice} from '../services/tradingMath';
import {
  computeXauBotStats,
  runWalkForwardBacktest,
  STRATEGY_LABELS,
  type BotEquityPoint,
} from '../services/xauBot';
import type {
  BacktestReport,
  Candle,
  Instrument,
  Position,
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotStrategy,
  XauBotTradeRecord,
} from '../types/trading';

interface BotStatsViewProps {
  xauInstrument: Instrument | null;
  xauCandles?: Candle[];
  timeframeLabel?: string;
  config: XauBotConfig;
  closedTrades: XauBotTradeRecord[];
  openBotPositions: Position[];
  adaptations: XauBotAdaptationEvent[];
  isOnline: boolean;
  onToggleBot: () => void;
  onToggleAutoLearn: () => void;
  onSelectStrategy?: (strategy: XauBotStrategy) => void;
  onOptimizeNow: () => void;
  onResetLearnedParams: () => void;
  onClosePosition: (positionId: string) => void;
  onGoToLiveChart: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

export const BotStatsView: React.FC<BotStatsViewProps> = ({
  xauInstrument,
  xauCandles = [],
  timeframeLabel = '15m',
  config,
  closedTrades,
  openBotPositions,
  adaptations,
  isOnline,
  onToggleBot,
  onToggleAutoLearn,
  onSelectStrategy,
  onOptimizeNow,
  onResetLearnedParams,
  onClosePosition,
  onGoToLiveChart,
}) => {
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'OPEN'>('ALL');
  const [hoveredPoint, setHoveredPoint] = useState<BotEquityPoint | null>(null);
  const [backtestReport, setBacktestReport] = useState<BacktestReport | null>(null);

  const stats = useMemo(
    () => computeXauBotStats(closedTrades, openBotPositions, xauInstrument),
    [closedTrades, openBotPositions, xauInstrument],
  );

  const sortedClosedTrades = useMemo(
    () => [...closedTrades].sort((a, b) => b.closedAt - a.closedAt),
    [closedTrades],
  );

  const visibleClosedTrades = useMemo(() => {
    if (tradeFilter === 'OPEN') return [];
    if (tradeFilter === 'WIN') return sortedClosedTrades.filter((t) => t.netPnl > 0);
    if (tradeFilter === 'LOSS') return sortedClosedTrades.filter((t) => t.netPnl < 0);
    return sortedClosedTrades;
  }, [sortedClosedTrades, tradeFilter]);

  const showOpenRows = tradeFilter === 'ALL' || tradeFilter === 'OPEN';

  const handleExportBotCsv = () => {
    const headers = [
      'OpenedAt',
      'ClosedAt',
      'Symbol',
      'Side',
      'Strategy',
      'Lots',
      'EntryPrice',
      'ExitPrice',
      'ExitReason',
      'ConfidencePct',
      'GrossPnL',
      'Fee',
      'NetPnL',
    ];
    const rows = sortedClosedTrades.map((t) => [
      new Date(t.openedAt).toISOString(),
      new Date(t.closedAt).toISOString(),
      t.symbol,
      t.side,
      t.strategy,
      t.quantity.toFixed(2),
      t.entryPrice.toFixed(2),
      t.exitPrice.toFixed(2),
      t.exitAction,
      t.confidenceAtEntry,
      t.grossPnl.toFixed(2),
      t.fee.toFixed(2),
      t.netPnl.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kestrel-xau-bot-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Top performing strategy label for self-learning summary
  const bestStrategy = useMemo(() => {
    const active = stats.strategyBreakdown.filter((s) => s.trades > 0);
    if (active.length === 0) return null;
    return [...active].sort((a, b) => b.netPnl - a.netPnl)[0];
  }, [stats.strategyBreakdown]);

  return (
    <div className="space-y-5">
      {/* Header & Primary Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            XAU/USD Bot Performance &amp; Adaptive Learning
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Strategy: {STRATEGY_LABELS[config.strategy]}</span>
            <span aria-hidden="true">·</span>
            <span>Auto-Learn: {config.autoLearnEnabled ? 'Active' : 'Manual'}</span>
            <span aria-hidden="true">·</span>
            <span>
              Status:{' '}
              <span
                className={
                  config.enabled
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {config.enabled ? 'Running on Live Feed' : 'Paused'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!isOnline}
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
            onClick={onToggleAutoLearn}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              config.autoLearnEnabled
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] text-slate-700 dark:text-slate-300'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Auto-Learn: {config.autoLearnEnabled ? 'On' : 'Off'}</span>
          </button>

          <button
            type="button"
            disabled={closedTrades.length < 2}
            onClick={onOptimizeNow}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1B2232] disabled:opacity-40 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-500" />
            <span>Optimize Now</span>
          </button>

          <button
            type="button"
            disabled={closedTrades.length === 0}
            onClick={handleExportBotCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1B2232] disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={onGoToLiveChart}
            className="px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Live Chart
          </button>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Total Bot Net P&amp;L
          </div>
          <div
            className={`mt-1 text-xl font-mono font-bold tabular-nums ${
              stats.totalNetPnl >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {stats.totalNetPnl >= 0 ? '+' : ''}
            {formatCurrency(stats.totalNetPnl)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Realized {stats.realizedNetPnl >= 0 ? '+' : ''}
            {formatCurrency(stats.realizedNetPnl)} · Open{' '}
            {stats.openUnrealizedPnl >= 0 ? '+' : ''}
            {formatCurrency(stats.openUnrealizedPnl)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Earned vs Lost (Closed)
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
              +{formatCurrency(stats.grossProfit)}
            </span>
            <span className="text-slate-400">/</span>
            <span className="text-base font-bold text-rose-600 dark:text-rose-400">
              -{formatCurrency(stats.grossLoss)}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Fees paid: {formatCurrency(stats.totalFees)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Win Rate &amp; Record
          </div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.winRate.toFixed(1)}%
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {stats.wins}W · {stats.losses}L · {openBotPositions.length} Open
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Profit Factor &amp; Expectancy
          </div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.closedCount > 0 ? stats.profitFactor.toFixed(2) : '--'}
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Avg {stats.expectancy >= 0 ? '+' : ''}
            {formatCurrency(stats.expectancy)} / trade
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4 col-span-2 sm:col-span-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Max Drawdown &amp; Streak
          </div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
            -{formatCurrency(stats.maxDrawdown)}
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Best +{formatCurrency(stats.bestTrade)} · Streak{' '}
            {stats.currentStreak > 0
              ? `+${stats.currentStreak}W`
              : stats.currentStreak < 0
              ? `${stats.currentStreak}L`
              : '0'}
          </div>
        </div>
      </div>

      {/* Equity Curve + Strategy Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Cumulative Bot Equity Curve */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Cumulative Bot P&amp;L Curve
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Realized cumulative net profit/loss across closed XAU/USD bot trades
              </p>
            </div>
            {hoveredPoint ? (
              <div className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
                Trade #{hoveredPoint.index} ({hoveredPoint.side}) ·{' '}
                <span
                  className={
                    hoveredPoint.tradeNet >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }
                >
                  {hoveredPoint.tradeNet >= 0 ? '+' : ''}
                  {formatCurrency(hoveredPoint.tradeNet)}
                </span>{' '}
                · Cum {hoveredPoint.cumNet >= 0 ? '+' : ''}
                {formatCurrency(hoveredPoint.cumNet)}
              </div>
            ) : (
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {stats.closedCount} settled trade{stats.closedCount === 1 ? '' : 's'}
              </div>
            )}
          </div>

          <BotEquityChart
            points={stats.equityCurve}
            onHover={setHoveredPoint}
          />
        </div>

        {/* Strategy Performance Comparison */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Strategy Performance Matrix
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Comparing realized net results per strategy engine used by the bot
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-left text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-2 font-medium">Strategy</th>
                  <th className="py-2 px-2 font-medium text-right">Trades</th>
                  <th className="py-2 px-2 font-medium text-right">Win %</th>
                  <th className="py-2 pl-2 font-medium text-right">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130]">
                {stats.strategyBreakdown.map((row) => {
                  const isCurrent = config.strategy === row.strategy;
                  const isLeader = bestStrategy?.strategy === row.strategy && row.trades > 0;
                  return (
                    <tr key={row.strategy}>
                      <td className="py-2.5 pr-2">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {row.label}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isCurrent ? 'Active' : 'Standby'}
                          {isLeader ? ' · Top Net' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.trades} ({row.wins}W/{row.losses}L)
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.trades > 0 ? `${row.winRate.toFixed(0)}%` : '--'}
                      </td>
                      <td
                        className={`py-2.5 pl-2 text-right font-mono font-semibold tabular-nums ${
                          row.netPnl > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.netPnl < 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {row.netPnl >= 0 ? '+' : ''}
                        {formatCurrency(row.netPnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Self-Learning & Parameter Adaptation Section */}
      <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Self-Learning &amp; Auto-Optimization Engine
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              When enabled, the bot evaluates closed trade outcomes after each exit and adapts strategy selection, confidence filter, SL/TP ratio, and defensive lot sizing.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetLearnedParams}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1B2232] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Learned Params</span>
          </button>
        </div>

        {/* Active Learned Parameter Snapshot */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Active Strategy</div>
            <div className="mt-0.5 font-medium text-slate-900 dark:text-white">
              {STRATEGY_LABELS[config.strategy]}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Min Confidence</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              {config.minConfidence}%
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Stop-Loss Buffer</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              ${config.stopLossDollars.toFixed(1)}/oz
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Take-Profit Target</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              ${config.takeProfitDollars.toFixed(1)}/oz
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Trailing Stop</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              {config.trailingStopDollars ? `$${config.trailingStopDollars.toFixed(1)}/oz` : 'Off'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Adaptive Lot Size</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              {config.lotSize.toFixed(2)} lots
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Max Open Trades</div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
              {config.maxConcurrentPositions} slots
            </div>
          </div>
        </div>

        {/* Adaptation History */}
        <div className="border-t border-slate-200 dark:border-[#1E2636] pt-3">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
            Learned Adjustments History ({adaptations.length})
          </div>
          {adaptations.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 py-2">
              No automatic adjustments yet. Once the bot completes 2 or more closed XAU/USD trades, it will evaluate win/loss expectancy and tune parameters automatically (or click &quot;Optimize Now&quot;).
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
              {adaptations.map((ev) => (
                <div key={ev.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <div>
                    <div className="font-mono font-medium text-blue-600 dark:text-blue-400">
                      {ev.summary}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {ev.reason}
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                    After #{ev.triggerTradeCount} ·{' '}
                    {new Date(ev.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Walk-Forward Strategy Backtester */}
      <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Walk-Forward Strategy Backtester (Live Historical Candles)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Zero-lookahead simulation across all 6 strategies on real {timeframeLabel} XAU/USD candles ({xauCandles.length} bars) including spread, fees, ATR SL/TP &amp; Auto BE.
            </p>
          </div>
          <button
            type="button"
            disabled={!xauInstrument || xauCandles.length < 35}
            onClick={() => {
              if (!xauInstrument || xauCandles.length < 35) return;
              setBacktestReport(
                runWalkForwardBacktest(xauInstrument, xauCandles, config, timeframeLabel),
              );
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 cursor-pointer transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run Backtest ({xauCandles.length} bars)</span>
          </button>
        </div>

        {backtestReport ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-left text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-2 font-medium">Strategy</th>
                  <th className="py-2 px-2 font-medium text-right">Trades</th>
                  <th className="py-2 px-2 font-medium text-right">Win %</th>
                  <th className="py-2 px-2 font-medium text-right">Profit Factor</th>
                  <th className="py-2 px-2 font-medium text-right">Max DD</th>
                  <th className="py-2 px-2 font-medium text-right">Expectancy</th>
                  <th className="py-2 px-2 font-medium text-right">Sim Net P&amp;L</th>
                  <th className="py-2 pl-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130]">
                {[...backtestReport.results]
                  .sort((a, b) => b.netPnl - a.netPnl)
                  .map((row) => {
                    const isRec = row.strategy === backtestReport.recommendedStrategy;
                    const isActive = row.strategy === config.strategy;
                    return (
                      <tr key={row.strategy}>
                        <td className="py-2 pr-2">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {row.label}
                          </div>
                          {isRec && (
                            <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                              Recommended on {backtestReport.barsTested}×{backtestReport.timeframeLabel}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {row.trades} ({row.wins}W/{row.losses}L)
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {row.trades > 0 ? `${row.winRate}%` : '--'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {row.trades > 0 ? row.profitFactor.toFixed(2) : '--'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                          -{formatCurrency(row.maxDrawdown)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-mono tabular-nums ${
                            row.expectancy >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {row.expectancy >= 0 ? '+' : ''}
                          {formatCurrency(row.expectancy)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-mono font-semibold tabular-nums ${
                            row.netPnl >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {row.netPnl >= 0 ? '+' : ''}
                          {formatCurrency(row.netPnl)}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          {onSelectStrategy && (
                            <button
                              type="button"
                              disabled={isActive}
                              onClick={() => onSelectStrategy(row.strategy)}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1B2232] disabled:opacity-40 cursor-pointer"
                            >
                              {isActive ? 'Active' : 'Use'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-slate-500 dark:text-slate-400 py-1">
            Click &quot;Run Backtest&quot; to test which strategy &amp; confluence performs best on the current XAU/USD market structure before trading live.
          </div>
        )}
      </div>

      {/* Bot Trade Ledger (Open + Closed Trades with Earned / Lost Result) */}
      <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Bot Trade History (Earned &amp; Lost)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete record of every XAU/USD position opened and closed by the bot
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636]">
            {(
              [
                {id: 'ALL', label: `All (${openBotPositions.length + sortedClosedTrades.length})`},
                {id: 'WIN', label: `Winners (${stats.wins})`},
                {id: 'LOSS', label: `Losers (${stats.losses})`},
                {id: 'OPEN', label: `Open (${openBotPositions.length})`},
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTradeFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  tradeFilter === tab.id
                    ? 'bg-white dark:bg-[#1B2232] text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-left text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3 font-medium">Time</th>
                <th className="py-2.5 px-3 font-medium">Side</th>
                <th className="py-2.5 px-3 font-medium">Strategy</th>
                <th className="py-2.5 px-3 font-medium text-right">Lots</th>
                <th className="py-2.5 px-3 font-medium text-right">Entry</th>
                <th className="py-2.5 px-3 font-medium text-right">Exit / Mark</th>
                <th className="py-2.5 px-3 font-medium">Outcome</th>
                <th className="py-2.5 px-3 font-medium text-right">Duration</th>
                <th className="py-2.5 px-3 font-medium text-right">Fee</th>
                <th className="py-2.5 px-3 font-medium text-right">Net Earned / Lost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130]">
              {showOpenRows &&
                openBotPositions.map((pos) => {
                  const mark = xauInstrument
                    ? pos.side === 'BUY'
                      ? xauInstrument.bid
                      : xauInstrument.ask
                    : pos.entryPrice;
                  const unreal = xauInstrument ? computeUnrealizedPnl(pos, xauInstrument) : 0;
                  return (
                    <tr
                      key={pos.id}
                      className="bg-blue-50/40 dark:bg-blue-950/15"
                    >
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                        {new Date(pos.openedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span
                          className={
                            pos.side === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }
                        >
                          {pos.side === 'BUY' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {STRATEGY_LABELS[pos.botStrategy || config.strategy]}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {pos.quantity.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatPrice(pos.entryPrice, 2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatPrice(mark, 2)}
                      </td>
                      <td className="py-2.5 px-3 text-blue-600 dark:text-blue-400 font-medium">
                        OPEN ·{' '}
                        <button
                          type="button"
                          onClick={() => onClosePosition(pos.id)}
                          className="underline hover:text-blue-700 cursor-pointer"
                        >
                          Close
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {formatDuration(Date.now() - pos.openedAt)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {formatCurrency(pos.commissionPaid)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                          unreal >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {unreal >= 0 ? '+' : ''}
                        {formatCurrency(unreal)}
                      </td>
                    </tr>
                  );
                })}

              {visibleClosedTrades.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-[#171E2C]/60">
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                    {new Date(t.closedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="py-2.5 px-3 font-semibold">
                    <span
                      className={
                        t.side === 'BUY'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }
                    >
                      {t.side === 'BUY' ? 'LONG' : 'SHORT'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                    {STRATEGY_LABELS[t.strategy]}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {t.quantity.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatPrice(t.entryPrice, 2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatPrice(t.exitPrice, 2)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                    {t.exitAction.replace('_', ' ')}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                    {formatDuration(t.closedAt - t.openedAt)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                    {formatCurrency(t.fee)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                      t.netPnl >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      {t.netPnl >= 0 ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {t.netPnl >= 0 ? '+' : ''}
                      {formatCurrency(t.netPnl)}
                    </span>
                  </td>
                </tr>
              ))}

              {visibleClosedTrades.length === 0 &&
                (!showOpenRows || openBotPositions.length === 0) && (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No XAU/USD bot trades recorded in this filter yet. Start the Auto Bot or run a live paper test from the Trade screen.
                    </td>
                  </tr>
                )}
            </tbody>
            {sortedClosedTrades.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] font-mono text-xs font-semibold tabular-nums">
                  <td colSpan={7} className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300">
                    Closed Totals ({sortedClosedTrades.length} trades)
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-500">
                    Gross {stats.realizedGrossPnl >= 0 ? '+' : ''}
                    {formatCurrency(stats.realizedGrossPnl)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-500">
                    -{formatCurrency(stats.totalFees)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right ${
                      stats.realizedNetPnl >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {stats.realizedNetPnl >= 0 ? '+' : ''}
                    {formatCurrency(stats.realizedNetPnl)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

const BotEquityChart: React.FC<{
  points: BotEquityPoint[];
  onHover: (pt: BotEquityPoint | null) => void;
}> = ({points, onHover}) => {
  if (points.length === 0) {
    return (
      <div className="h-52 rounded-lg border border-dashed border-slate-200 dark:border-[#222B3D] flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 px-4 text-center">
        Equity curve populates automatically once the XAU/USD bot settles its first closed trade.
      </div>
    );
  }

  const width = 640;
  const height = 210;
  const padX = 48;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const series = [{index: 0, cumNet: 0}, ...points];
  const values = series.map((p) => p.cumNet);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(0, ...values);
  const span = Math.max(10, maxVal - minVal);

  const toX = (i: number) =>
    padX + (series.length > 1 ? (i / (series.length - 1)) * innerW : innerW / 2);
  const toY = (v: number) => padY + ((maxVal - v) / span) * innerH;

  const zeroY = toY(0);
  const linePath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.cumNet).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${toX(series.length - 1).toFixed(1)} ${zeroY.toFixed(
    1,
  )} L ${toX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const lastCum = points[points.length - 1].cumNet;
  const strokeColor = lastCum >= 0 ? '#10b981' : '#f43f5e';
  const fillColor = lastCum >= 0 ? 'rgba(16,185,129,0.14)' : 'rgba(244,63,94,0.14)';

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-52 select-none"
        onMouseLeave={() => onHover(null)}
      >
        {/* Zero baseline */}
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="currentColor"
          className="text-slate-300 dark:text-slate-700"
          strokeDasharray="4 4"
        />
        <text
          x={padX - 6}
          y={zeroY + 4}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          $0
        </text>
        <text
          x={padX - 6}
          y={padY + 6}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          {maxVal >= 0 ? '+' : ''}
          {Math.round(maxVal)}
        </text>
        <text
          x={padX - 6}
          y={height - padY}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          {Math.round(minVal)}
        </text>

        <path d={areaPath} fill={fillColor} />
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />

        {points.map((pt, idx) => {
          const cx = toX(idx + 1);
          const cy = toY(pt.cumNet);
          return (
            <circle
              key={`${pt.index}-${pt.timestamp}`}
              cx={cx}
              cy={cy}
              r={4.5}
              fill={pt.tradeNet >= 0 ? '#10b981' : '#f43f5e'}
              className="cursor-pointer opacity-85 hover:opacity-100"
              onMouseEnter={() => onHover(pt)}
            />
          );
        })}
      </svg>
    </div>
  );
};
