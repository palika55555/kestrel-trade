import React, {useMemo, useState} from 'react';
import {Download, FileCheck2} from 'lucide-react';
import {formatCurrency} from '../services/tradingMath';
import type {EODReport} from '../types/trading';

interface EODReportsViewProps {
  reports: EODReport[];
  onGenerateTodayReport: () => void;
}

export const EODReportsView: React.FC<EODReportsViewProps> = ({
  reports,
  onGenerateTodayReport,
}) => {
  const [range, setRange] = useState<'7D' | '14D' | 'ALL'>('ALL');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    reports[0]?.id || null,
  );

  const visibleReports = useMemo(() => {
    const sorted = [...reports].sort((a, b) => b.date.localeCompare(a.date));
    if (range === '7D') return sorted.slice(0, 7);
    if (range === '14D') return sorted.slice(0, 14);
    return sorted;
  }, [reports, range]);

  const chronological = useMemo(
    () => [...visibleReports].reverse(),
    [visibleReports],
  );

  const stats = useMemo(() => {
    if (visibleReports.length === 0) {
      return {
        totalNet: 0,
        cumReturnPct: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpe: 0,
        totalFees: 0,
      };
    }
    const totalNet = visibleReports.reduce((acc, r) => acc + r.netPnl, 0);
    const oldest = chronological[0];
    const newest = chronological[chronological.length - 1];
    const cumReturnPct =
      oldest.startingEquity > 0
        ? ((newest.endingEquity - oldest.startingEquity) / oldest.startingEquity) * 100
        : 0;
    const totalTrades = visibleReports.reduce((a, r) => a + r.tradesCount, 0);
    const totalWins = visibleReports.reduce((a, r) => a + r.winCount, 0);
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    const grossProfit = visibleReports
      .filter((r) => r.netPnl > 0)
      .reduce((a, r) => a + r.netPnl, 0);
    const grossLoss = Math.abs(
      visibleReports
        .filter((r) => r.netPnl < 0)
        .reduce((a, r) => a + r.netPnl, 0),
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 3.5 : 0;
    const maxDrawdown = Math.max(...visibleReports.map((r) => r.maxDrawdownPct));
    const totalFees = visibleReports.reduce(
      (a, r) => a + r.commissions + r.swapFees,
      0,
    );

    const returns = visibleReports.map((r) => r.returnPct);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      Math.max(1, returns.length - 1);
    const std = Math.sqrt(variance) || 0.5;
    const sharpe = (mean / std) * Math.sqrt(252);

    return {
      totalNet,
      cumReturnPct,
      winRate,
      profitFactor,
      maxDrawdown,
      sharpe,
      totalFees,
    };
  }, [visibleReports, chronological]);

  const selectedReport =
    visibleReports.find((r) => r.id === selectedReportId) || visibleReports[0];

  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Starting Equity',
      'Ending Equity',
      'Realized PnL',
      'Unrealized PnL',
      'Commissions',
      'Swap Fees',
      'Net PnL',
      'Return %',
      'Trades',
      'Win Rate %',
      'Profit Factor',
      'Max Drawdown %',
    ];
    const rows = visibleReports.map((r) => [
      r.date,
      r.startingEquity.toFixed(2),
      r.endingEquity.toFixed(2),
      r.realizedPnl.toFixed(2),
      r.unrealizedPnl.toFixed(2),
      r.commissions.toFixed(2),
      r.swapFees.toFixed(2),
      r.netPnl.toFixed(2),
      r.returnPct.toFixed(2),
      r.tradesCount,
      r.winRate.toFixed(1),
      r.profitFactor.toFixed(2),
      r.maxDrawdownPct.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kestrel-eod-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            End-of-Day Settlement & Performance
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Historical daily mark-to-market ledger, drawdown trends, and CSV statements
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636]">
            {(['7D', '14D', 'ALL'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  range === r
                    ? 'bg-white dark:bg-[#1E2636] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onGenerateTodayReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Close Today&apos;s EOD</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1B2232] transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Institutional Performance KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Cumulative Net P&L"
          value={`${stats.totalNet >= 0 ? '+' : ''}${formatCurrency(stats.totalNet)}`}
          positive={stats.totalNet >= 0}
        />
        <KpiCard
          label="Period Return"
          value={`${stats.cumReturnPct >= 0 ? '+' : ''}${stats.cumReturnPct.toFixed(2)}%`}
          positive={stats.cumReturnPct >= 0}
        />
        <KpiCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
        <KpiCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} />
        <KpiCard
          label="Annualized Sharpe"
          value={stats.sharpe.toFixed(2)}
          positive={stats.sharpe >= 1}
        />
        <KpiCard
          label="Max Intraday DD"
          value={`-${stats.maxDrawdown.toFixed(2)}%`}
          positive={false}
        />
      </div>

      {/* Equity Curve + Daily P&L Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Historical Equity Curve & Daily P&L
            </h2>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Fees & Swaps: {formatCurrency(stats.totalFees)}
            </span>
          </div>

          <EquityAndPnlSvg reports={chronological} />
        </div>

        {/* Selected Day Breakdown */}
        <div className="lg:col-span-4 bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-3">
          {selectedReport ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1E2636] pb-2.5">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    EOD Settlement Statement
                  </div>
                  <div className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                    {selectedReport.date}
                  </div>
                </div>
                <span
                  className={`text-sm font-mono font-semibold ${
                    selectedReport.netPnl >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {selectedReport.netPnl >= 0 ? '+' : ''}
                  {formatCurrency(selectedReport.netPnl)}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <RowStat
                  label="Starting Equity"
                  value={formatCurrency(selectedReport.startingEquity)}
                />
                <RowStat
                  label="Ending Equity"
                  value={formatCurrency(selectedReport.endingEquity)}
                />
                <RowStat
                  label="Realized P&L"
                  value={formatCurrency(selectedReport.realizedPnl)}
                />
                <RowStat
                  label="Unrealized MtM"
                  value={formatCurrency(selectedReport.unrealizedPnl)}
                />
                <RowStat
                  label="Commissions"
                  value={formatCurrency(selectedReport.commissions)}
                />
                <RowStat
                  label="Overnight Swaps"
                  value={formatCurrency(selectedReport.swapFees)}
                />
                <RowStat
                  label="Peak Margin Used"
                  value={formatCurrency(selectedReport.peakMarginUsed)}
                />
                <RowStat
                  label="Trades (W / L)"
                  value={`${selectedReport.tradesCount} (${selectedReport.winCount}W / ${selectedReport.lossCount}L)`}
                />
              </div>

              <div className="pt-2.5 border-t border-slate-100 dark:border-[#1E2636] space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  P&L Attribution by Asset Class
                </div>
                {Object.entries(selectedReport.assetBreakdown).map(([cls, val]) => (
                  <div key={cls} className="flex justify-between text-xs font-mono">
                    <span className="text-slate-600 dark:text-slate-300 font-sans">
                      {cls.replace('_', ' ')}
                    </span>
                    <span
                      className={
                        val >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }
                    >
                      {val >= 0 ? '+' : ''}
                      {formatCurrency(val)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500">
              Select a date row to inspect settlement details.
            </div>
          )}
        </div>
      </div>

      {/* Historical Daily Ledger */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Daily Settlement Ledger
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click a session row to view attribution
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-3 text-right">Start Equity</th>
                <th className="py-2.5 px-3 text-right">End Equity</th>
                <th className="py-2.5 px-3 text-right">Trades</th>
                <th className="py-2.5 px-3 text-right">Win Rate</th>
                <th className="py-2.5 px-3 text-right">Fees / Swaps</th>
                <th className="py-2.5 px-3 text-right">Net P&L</th>
                <th className="py-2.5 px-4 text-right">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
              {visibleReports.map((r) => {
                const active = selectedReport?.id === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedReportId(r.id)}
                    className={`cursor-pointer h-11 transition-colors ${
                      active
                        ? 'bg-blue-50/70 dark:bg-blue-950/25'
                        : 'hover:bg-slate-50 dark:hover:bg-[#161D2A]'
                    }`}
                  >
                    <td className="py-2 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {r.date}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatCurrency(r.startingEquity)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCurrency(r.endingEquity)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {r.tradesCount}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {r.winRate.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatCurrency(r.commissions + r.swapFees)}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                        r.netPnl >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {r.netPnl >= 0 ? '+' : ''}
                      {formatCurrency(r.netPnl)}
                    </td>
                    <td
                      className={`py-2 px-4 text-right font-mono tabular-nums ${
                        r.returnPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {r.returnPct >= 0 ? '+' : ''}
                      {r.returnPct.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{label: string; value: string; positive?: boolean}> = ({
  label,
  value,
  positive,
}) => (
  <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-3">
    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
    <div
      className={`mt-1 text-base font-mono font-semibold tabular-nums ${
        positive === undefined
          ? 'text-slate-900 dark:text-white'
          : positive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {value}
    </div>
  </div>
);

const RowStat: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="flex justify-between py-0.5">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
  </div>
);

const EquityAndPnlSvg: React.FC<{reports: EODReport[]}> = ({reports}) => {
  if (reports.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-slate-500">
        No EOD reports available.
      </div>
    );
  }

  const w = 720;
  const h = 230;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const equities = reports.map((r) => r.endingEquity);
  const minEq = Math.min(...equities) * 0.995;
  const maxEq = Math.max(...equities) * 1.005;
  const eqSpan = maxEq - minEq || 1;

  const maxAbsPnl = Math.max(100, ...reports.map((r) => Math.abs(r.netPnl)));
  const barZoneH = plotH * 0.28;
  const barBaseY = padT + plotH;

  const points = reports.map((r, i) => {
    const x =
      reports.length === 1
        ? padL + plotW / 2
        : padL + (i / (reports.length - 1)) * plotW;
    const y = padT + ((maxEq - r.endingEquity) / eqSpan) * (plotH - barZoneH - 12);
    return {x, y, r};
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(
    padT +
    plotH -
    barZoneH -
    6
  ).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + plotH - barZoneH - 6).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto overflow-visible"
      role="img"
      aria-label="Equity curve and daily P&L chart"
    >
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {/* Y-axis ticks */}
      {[0, 0.5, 1].map((t) => {
        const val = minEq + eqSpan * t;
        const y = padT + (1 - t) * (plotH - barZoneH - 12);
        return (
          <g key={t}>
            <line
              x1={padL}
              y1={y}
              x2={w - padR}
              y2={y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-800"
              strokeDasharray="3 3"
            />
            <text
              x={padL - 8}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[10px] font-mono"
            >
              {formatCurrency(val, true)}
            </text>
          </g>
        );
      })}

      <path d={areaPath} fill="url(#eqGrad)" />
      <path d={linePath} fill="none" stroke="#3B82F6" strokeWidth="2.2" />

      {points.map((p, idx) => {
        const barW = Math.max(6, Math.min(22, plotW / Math.max(1, reports.length * 1.8)));
        const barH = (Math.abs(p.r.netPnl) / maxAbsPnl) * barZoneH;
        const barY = barBaseY - barH;
        return (
          <g key={p.r.id}>
            <rect
              x={p.x - barW / 2}
              y={barY}
              width={barW}
              height={Math.max(2, barH)}
              rx="2"
              fill={p.r.netPnl >= 0 ? '#10B981' : '#EF4444'}
              opacity="0.85"
            />
            <circle cx={p.x} cy={p.y} r="3" fill="#3B82F6" />
            {(idx === 0 || idx === points.length - 1 || idx % 3 === 0) && (
              <text
                x={p.x}
                y={h - 6}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {p.r.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
