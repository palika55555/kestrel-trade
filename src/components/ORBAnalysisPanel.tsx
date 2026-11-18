import React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BellPlus,
  CheckCircle2,
  Compass,
  MinusCircle,
} from 'lucide-react';
import {formatPrice} from '../services/tradingMath';
import type {
  Instrument,
  ORBAnalysis,
  ORBWindowMinutes,
  StagedOrderPreset,
} from '../types/trading';

interface ORBAnalysisPanelProps {
  instrument: Instrument;
  analysis: ORBAnalysis | null;
  windowMinutes: ORBWindowMinutes;
  onChangeWindow: (w: ORBWindowMinutes) => void;
  onStageOrder: (preset: StagedOrderPreset) => void;
  onArmORBAlerts: (analysis: ORBAnalysis) => void;
}

export const ORBAnalysisPanel: React.FC<ORBAnalysisPanelProps> = ({
  instrument,
  analysis,
  windowMinutes,
  onChangeWindow,
  onStageOrder,
  onArmORBAlerts,
}) => {
  if (!analysis) {
    return (
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 text-xs text-slate-500 dark:text-slate-400">
        Gathering OHLCV bars for {instrument.symbol} Opening Range Breakout (ORB) analysis...
      </div>
    );
  }

  const dec = instrument.decimals;
  const signalLabel = formatSignalLabel(analysis.signal);
  const biasColor =
    analysis.bias === 'LONG'
      ? 'text-emerald-600 dark:text-emerald-400'
      : analysis.bias === 'SHORT'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-amber-600 dark:text-amber-400';

  const handleStage = (side: 'BUY' | 'SELL') => {
    const plan = side === 'BUY' ? analysis.longPlan : analysis.shortPlan;
    const isImmediate =
      (side === 'BUY' &&
        (analysis.signal === 'LONG_BREAKOUT' || analysis.signal === 'LONG_RETEST')) ||
      (side === 'SELL' &&
        (analysis.signal === 'SHORT_BREAKOUT' || analysis.signal === 'SHORT_RETEST'));

    onStageOrder({
      symbol: instrument.symbol,
      side,
      type: isImmediate ? 'MARKET' : 'STOP',
      triggerPrice: isImmediate ? undefined : plan.entryPrice,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit2R,
      sourceLabel: `ORB ${windowMinutes}m ${side}`,
      nonce: Date.now(),
    });
  };

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      {/* Header & ORB Window Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
        <div className="flex items-center gap-2.5">
          <Compass className="w-4 h-4 text-blue-500 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ORB Signal &amp; Long / Short Analyzer
              </h2>
              <span className="text-xs text-slate-400">·</span>
              <span className={`text-xs font-mono font-semibold ${biasColor}`}>
                {signalLabel} ({analysis.confidenceScore}% confluence)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {analysis.rationale}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0D1119]">
            {([15, 30, 60] as ORBWindowMinutes[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onChangeWindow(w)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded-md transition-colors cursor-pointer ${
                  windowMinutes === w
                    ? 'bg-white dark:bg-[#1C2433] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {w}m ORB
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onArmORBAlerts(analysis)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] transition-colors whitespace-nowrap cursor-pointer"
          >
            <BellPlus className="w-3.5 h-3.5 text-amber-500" />
            <span>Auto-Arm ORB Alerts</span>
          </button>
        </div>
      </div>

      {/* Key Levels Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
        <MetricCell
          label="OR High"
          value={formatPrice(analysis.orHigh, dec)}
          tone="emerald"
        />
        <MetricCell
          label="OR Midpoint"
          value={formatPrice(analysis.orMid, dec)}
        />
        <MetricCell
          label="OR Low"
          value={formatPrice(analysis.orLow, dec)}
          tone="rose"
        />
        <MetricCell
          label="Range Width"
          value={`${formatPrice(analysis.rangeWidth, dec)} (${analysis.rangeWidthPct.toFixed(2)}%)`}
        />
        <MetricCell label="Session VWAP" value={formatPrice(analysis.vwap, dec)} />
        <MetricCell
          label="RSI(14) · Vol"
          value={`${analysis.rsi14.toFixed(1)} · ${analysis.volumeRatio.toFixed(2)}x`}
        />
      </div>

      {/* Side-by-side Actionable WHEN TO LONG vs WHEN TO SHORT Plans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* LONG Plan */}
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight className="w-4 h-4" />
              <span>When to LONG</span>
            </div>
            <button
              type="button"
              onClick={() => handleStage('BUY')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              Stage Long
            </button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {analysis.longPlan.conditionSummary}
          </p>
          <div className="grid grid-cols-4 gap-2 pt-1 text-[11px] font-mono tabular-nums">
            <div>
              <div className="text-slate-400 font-sans">Entry</div>
              <div className="text-slate-900 dark:text-white font-medium">
                {formatPrice(analysis.longPlan.entryPrice, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Stop-Loss</div>
              <div className="text-rose-600 dark:text-rose-400 font-medium">
                {formatPrice(analysis.longPlan.stopLoss, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">TP 1.5R</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                {formatPrice(analysis.longPlan.takeProfit1R, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">TP 2.5R</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                {formatPrice(analysis.longPlan.takeProfit2R, dec)}
              </div>
            </div>
          </div>
        </div>

        {/* SHORT Plan */}
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.04] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
              <ArrowDownRight className="w-4 h-4" />
              <span>When to SHORT</span>
            </div>
            <button
              type="button"
              onClick={() => handleStage('SELL')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer"
            >
              Stage Short
            </button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {analysis.shortPlan.conditionSummary}
          </p>
          <div className="grid grid-cols-4 gap-2 pt-1 text-[11px] font-mono tabular-nums">
            <div>
              <div className="text-slate-400 font-sans">Entry</div>
              <div className="text-slate-900 dark:text-white font-medium">
                {formatPrice(analysis.shortPlan.entryPrice, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Stop-Loss</div>
              <div className="text-rose-600 dark:text-rose-400 font-medium">
                {formatPrice(analysis.shortPlan.stopLoss, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">TP 1.5R</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                {formatPrice(analysis.shortPlan.takeProfit1R, dec)}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">TP 2.5R</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                {formatPrice(analysis.shortPlan.takeProfit2R, dec)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Factor Confluence Verification Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 border-t border-slate-100 dark:border-[#1E2636]">
        {analysis.confluenceChecks.map((chk) => (
          <div key={chk.label} className="pt-2 flex items-start gap-1.5 text-[11px]">
            {chk.passed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <MinusCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                {chk.label}
              </div>
              <div className="text-slate-500 dark:text-slate-400 truncate">
                {chk.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function formatSignalLabel(sig: ORBAnalysis['signal']): string {
  switch (sig) {
    case 'LONG_BREAKOUT':
      return 'LONG BREAKOUT';
    case 'LONG_RETEST':
      return 'LONG RETEST';
    case 'SHORT_BREAKOUT':
      return 'SHORT BREAKOUT';
    case 'SHORT_RETEST':
      return 'SHORT RETEST';
    case 'INSIDE_RANGE':
      return 'INSIDE RANGE';
  }
}

const MetricCell: React.FC<{
  label: string;
  value: string;
  tone?: 'emerald' | 'rose';
}> = ({label, value, tone}) => (
  <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] px-2.5 py-2">
    <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
    <div
      className={`mt-0.5 font-mono font-semibold tabular-nums truncate ${
        tone === 'emerald'
          ? 'text-emerald-600 dark:text-emerald-400'
          : tone === 'rose'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-slate-900 dark:text-slate-100'
      }`}
    >
      {value}
    </div>
  </div>
);
